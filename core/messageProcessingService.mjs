import { matchesQuery, matchesAttachmentQuery } from '../modules/queryMatcher.mjs';
import { compileRules } from '../modules/ruleCompiler.mjs';
import { extractBodyText, extractEmail, extractName, sanitizePathPart } from '../modules/mailUtils.mjs';
import { folderInfoFromHeader, filterRulesForMessage } from './ruleEngine.mjs';
import { createSingleFlight } from '../modules/singleFlight.mjs';
import {
  duplicateSourcesForNotification,
  normalizeProcessingResult
} from '../modules/processingResult.mjs';
import {
  createOperationId,
  logDeveloperEvent
} from '../modules/developerLog.mjs';
import {
  MAIL_API_TIMEOUT_MS,
  isOperationTimeout,
  withTimeout as withDefaultTimeout
} from '../modules/operationTimeout.mjs';

function formatDateKey(dateLike) {
  const date = dateLike ? new Date(dateLike) : new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildRelativeDir(settings, rule, meta) {
  const parts = [];
  if (settings.basePath) parts.push(sanitizePathPart(settings.basePath));
  if (rule.basePath) parts.push(sanitizePathPart(rule.basePath));
  const ruleFolder = sanitizePathPart(rule.folder || 'Files');
  const account = sanitizePathPart(meta.accountName || 'unknown-account');
  const sender = sanitizePathPart(meta.senderEmail || meta.senderName || 'unknown-sender');
  const day = sanitizePathPart(meta.dateKey || formatDateKey());
  switch (rule.saveMode) {
    case 'by_rule': parts.push(ruleFolder); break;
    case 'by_sender': parts.push(ruleFolder, sender); break;
    case 'by_account': parts.push(ruleFolder, account); break;
    case 'by_date': parts.push(ruleFolder, day); break;
    default: parts.push(ruleFolder, account, sender, day); break;
  }
  return parts.filter(Boolean).join('/');
}

function firstHeaderValue(headers, name) {
  if (!headers || !name) return '';
  const wanted = String(name).toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() !== wanted) continue;
    return Array.isArray(value) ? String(value[0] || '') : String(value || '');
  }
  return '';
}

export function normalizeMessageImportance(messageHeader, fullMessage) {
  const direct = String(
    (messageHeader && (messageHeader.importance || messageHeader.priority)) || ''
  ).trim().toLowerCase();
  const headers = (fullMessage && fullMessage.headers) || {};
  const importance = firstHeaderValue(headers, 'importance').trim().toLowerCase();
  const priority = firstHeaderValue(headers, 'priority').trim().toLowerCase();
  const xPriority = firstHeaderValue(headers, 'x-priority').trim().toLowerCase();
  const combined = [direct, importance, priority, xPriority].filter(Boolean).join(' ');
  if (/(^|\s)(high|highest|urgent)(\s|$)/.test(combined) || /^[12](\s|$)/.test(xPriority)) return 'high';
  if (/(^|\s)(low|lowest|non-urgent|nonurgent)(\s|$)/.test(combined) || /^5(\s|$)/.test(xPriority)) return 'low';
  if (/(^|\s)(normal|medium)(\s|$)/.test(combined) || /^3(\s|$)/.test(xPriority)) return 'normal';
  return 'unknown';
}

function buildExportFingerprint(meta) {
  return [
    String(meta.accountName || '').trim().toLowerCase(),
    String(meta.senderEmail || '').trim().toLowerCase(),
    String(meta.subject || '').trim().toLowerCase(),
    String(meta.receivedDate || '').trim(),
    String(meta.attachmentName || '').trim().toLowerCase(),
    String(meta.attachmentSize || 0),
    String(meta.ruleFolder || '').trim().toLowerCase(),
    String(meta.savedAs || '').trim().toLowerCase()
  ].join('||');
}

export function createMessageProcessingService({
  messenger,
  getRules,
  getSettings,
  listAccounts,
  logAttachment: defaultLogAttachment,
  logMessageAudit: defaultLogMessageAudit,
  applyResultFeedback,
  saveUniqueAttachment,
  developerLog = logDeveloperEvent,
  logger = console,
  mailApiTimeoutMs = MAIL_API_TIMEOUT_MS,
  withTimeout = withDefaultTimeout
}) {
  const processing = createSingleFlight();
  let runtimeContext = null;
  let contextPromise = null;
  let contextExpiresAt = 0;
  const contextTtlMs = 60 * 1000;
  const trace = async event => {
    try {
      await developerLog(event);
    } catch (_) {}
  };
  const callMailApi = async (operationName, operation) => {
    try {
      return await withTimeout(operation, { operationName, timeoutMs: mailApiTimeoutMs });
    } catch (error) {
      if (error && typeof error === 'object' && !error.mailOperation) {
        try { error.mailOperation = operationName; } catch (_) {}
      }
      throw error;
    }
  };
  const applyFeedback = async (messageId, status, subject, operationId) => {
    try {
      await callMailApi('feedback.tags', () =>
        applyResultFeedback(messageId, status, subject)
      );
    } catch (error) {
      await trace({
        operationId,
        area: 'message-processing',
        stage: 'feedback-failed',
        ok: false,
        details: { messageId, error: String(error) }
      });
    }
  };

  async function getMessageData(messageHeader, attachments, { includeBody = true } = {}) {
    let fullBody = '';
    let fullMessage = null;
    if (includeBody) {
      try {
        fullMessage = await callMailApi('messages.getFull', () =>
          messenger.messages.getFull(messageHeader.id)
        );
        fullBody = extractBodyText(fullMessage);
      } catch (error) {
        logger.error('getFull failed', error);
        if (isOperationTimeout(error)) throw error;
      }
    }
    return {
      subject: messageHeader.subject || '',
      body: fullBody,
      sender_email: extractEmail(messageHeader.author || ''),
      sender_name: extractName(messageHeader.author || ''),
      importance: normalizeMessageImportance(messageHeader, fullMessage),
      attachments: (attachments || []).map(attachment => ({ name: attachment.name || '' }))
    };
  }

  async function createRuntimeContext({ refresh = false } = {}) {
    const now = Date.now();
    if (!refresh && runtimeContext && now < contextExpiresAt) return runtimeContext;
    if (!refresh && contextPromise) return await contextPromise;
    contextPromise = Promise.all([
      getRules(),
      getSettings(),
      callMailApi('accounts.list', () => listAccounts())
    ])
      .then(([rules, settings, accounts]) => {
        const normalizedRules = Array.isArray(rules) ? rules : [];
        runtimeContext = Object.freeze({
          rules: normalizedRules,
          compiledRules: compileRules(normalizedRules),
          settings: settings || {},
          accounts: Array.isArray(accounts) ? accounts : []
        });
        contextExpiresAt = Date.now() + contextTtlMs;
        return runtimeContext;
      })
      .finally(() => {
        contextPromise = null;
      });
    return await contextPromise;
  }

  function invalidateRuntimeContext() {
    runtimeContext = null;
    contextExpiresAt = 0;
  }

  async function saveAttachmentBuffer(buffer, path) {
    const url = URL.createObjectURL(new Blob([buffer]));
    const downloadId = await callMailApi('downloads.download', () =>
      messenger.downloads.download({
        url,
        filename: path,
        conflictAction: 'uniquify',
        saveAs: false
      })
    );
    let fullPath = '';
    try {
      const found = await callMailApi('downloads.search', () =>
        messenger.downloads.search({ id: downloadId })
      );
      fullPath = found && found.length ? (found[0].filename || '') : '';
    } catch (_) {}
    return { downloadId, fullPath };
  }

  async function processCore(messageId, {
    saveAttachments = false,
    context = null,
    logAttachment = defaultLogAttachment,
    logMessageAudit = defaultLogMessageAudit
  } = {}) {
    const operationId = createOperationId(saveAttachments ? 'save' : 'scan');
    if (saveAttachments) {
      await trace({
        operationId,
        area: 'save',
        stage: 'started',
        details: { messageId }
      });
    }
    const activeContext = context || await createRuntimeContext();
    const rules = activeContext.rules;
    const checkedAt = new Date();
    if (!rules.length) return { status: 'no_rules', checked: true, processed: 0 };
    const settings = activeContext.settings;
    const messageHeader = await callMailApi('messages.get', () =>
      messenger.messages.get(messageId)
    );
    const applicableCompiledRules = activeContext.compiledRules.filter(item =>
      item.valid && filterRulesForMessage([item.rule], messageHeader).length
    );
    const accounts = activeContext.accounts;
    const account = accounts.find(item =>
      String(item.id) === String((messageHeader.folder && messageHeader.folder.accountId) || '')
    );
    const accountName = account
      ? (account.name || account.id)
      : String((messageHeader.folder && messageHeader.folder.accountId) || '');
    const senderEmail = extractEmail(messageHeader.author || '');
    const senderName = extractName(messageHeader.author || '');
    const receivedAt = new Date(messageHeader.date || Date.now());
    const headerMessageId = messageHeader.headerMessageId || '';
    const auditBase = {
      checkedDate: checkedAt.toLocaleDateString(),
      checkedTime: checkedAt.toLocaleTimeString(),
      receivedDate: receivedAt.toLocaleDateString(),
      receivedTime: receivedAt.toLocaleTimeString(),
      importance: normalizeMessageImportance(messageHeader, null),
      accountName,
      senderName,
      senderEmail,
      subject: messageHeader.subject || '',
      messageId,
      headerMessageId
    };

    let attachments = [];
    if (applicableCompiledRules.length) {
      try {
        attachments = await callMailApi('messages.listAttachments', () =>
          messenger.messages.listAttachments(messageId)
        );
      } catch (error) {
        const reason = `Не удалось получить список вложений: ${String(error)}`;
        await logMessageAudit({
          ...auditBase,
          ruleCheckedCount: applicableCompiledRules.length,
          status: 'Ошибка',
          reason,
          processedCount: 0
        });
        await applyFeedback(messageId, 'Ошибка', messageHeader.subject || '', operationId);
        await trace({
          operationId,
          area: 'message-processing',
          stage: 'attachments-list-failed',
          ok: false,
          details: {
            messageId,
            mailOperation: error && error.mailOperation || 'messages.listAttachments',
            error: String(error)
          }
        });
        return {
          status: 'error',
          checked: true,
          error: String(error),
          mailOperation: error && error.mailOperation || 'messages.listAttachments',
          auditStatus: 'Ошибка',
          reason
        };
      }
    }

    const hasAttachments = Boolean(attachments && attachments.length);
    const applicableRules = applicableCompiledRules.map(item => item.rule);
    if (!hasAttachments && !applicableRules.length) {
      await logMessageAudit({
        ...auditBase,
        ruleCheckedCount: 0,
        status: 'Проверено',
        reason: 'В письме нет вложений и нет применимых правил',
        processedCount: 0
      });
      return { status: 'checked', checked: true, processed: 0 };
    }
    if (!applicableRules.length) {
      const folderInfo = folderInfoFromHeader(messageHeader);
      const allRuleFolders = rules.map(rule => JSON.stringify({
        folderKeys: rule.folderKeys || [],
        folderObjects: rule.folderObjects || []
      })).join(' | ');
      await logMessageAudit({
        ...auditBase,
        ruleCheckedCount: 0,
        status: 'Не подошло ни под одно правило',
        reason: `Нет применимых правил по точному ящику/папке; account=${folderInfo.accountId}; rawPath=${folderInfo.rawPath}; rawName=${folderInfo.rawName}; normalizedPath=${folderInfo.normalizedPath}; normalizedName=${folderInfo.normalizedName}; ruleFolders=${allRuleFolders || 'ALL'}`,
        processedCount: 0
      });
      return { status: 'not_matched', checked: true, processed: 0 };
    }

    const messageData = await getMessageData(messageHeader, attachments, {
      includeBody: applicableCompiledRules.some(item => item.needsBody)
    });
    auditBase.importance = messageData.importance || auditBase.importance;
    const matchedRules = applicableCompiledRules
      .filter(item => {
        try {
          return matchesQuery(item.tree, messageData);
        } catch (_) {
          return false;
        }
      });

    if (!matchedRules.length) {
      await logMessageAudit({
        ...auditBase,
        ruleCheckedCount: applicableRules.length,
        status: 'Не подошло ни под одно правило',
        reason: 'Письмо не совпало ни с одним правилом',
        processedCount: 0
      });
      return { status: 'not_matched', checked: true, processed: 0 };
    }

    const meta = {
      accountName,
      senderName: messageData.sender_name,
      senderEmail: messageData.sender_email,
      dateKey: formatDateKey(messageHeader.date)
    };
    let processed = 0;
    let alreadySaved = 0;
    let hadErrors = false;
    let hadDuplicates = false;
    const duplicateSources = [];
    let hadAttachmentMatches = false;
    const firstMatchedRule = matchedRules[0] && matchedRules[0].rule;
    const receivedDate = new Date(messageHeader.date || Date.now()).toLocaleDateString();
    const receivedTime = new Date(messageHeader.date || Date.now()).toLocaleTimeString();

    if (!hasAttachments) {
      const effectiveRules = settings.stopAfterFirstMatch === true
        ? matchedRules.slice(0, 1)
        : matchedRules;
      for (const item of effectiveRules) {
        const rule = item.rule;
        await logAttachment({
          accountName: meta.accountName,
          senderName: meta.senderName,
          senderEmail: meta.senderEmail,
          subject: messageHeader.subject || '',
          importance: messageData.importance || 'unknown',
          attachmentName: '',
          partName: '',
          attachmentSize: 0,
          ruleFolder: rule.folder || '',
          ruleName: rule.name || '',
          ruleQuery: rule.query || '',
          downloadId: null,
          fullPath: '',
          savedAs: '',
          messageId,
          headerMessageId,
          receivedDate,
          receivedTime,
          status: 'no_attachment'
        });
        processed += 1;
      }
      await logMessageAudit({
        ...auditBase,
        ruleCheckedCount: applicableRules.length,
        matchedRuleQuery: firstMatchedRule && firstMatchedRule.query || '',
        matchedRuleFolder: firstMatchedRule && firstMatchedRule.folder || '',
        matchedRuleName: firstMatchedRule && firstMatchedRule.name || '',
        status: 'Совпало правило',
        reason: 'Письмо без вложений учтено в статистике по правилу',
        processedCount: processed
      });
      await applyFeedback(messageId, 'Совпало правило', messageHeader.subject || '', operationId);
      return {
        status: 'no_attachments',
        checked: true,
        matched: true,
        processed,
        saved: 0,
        auditStatus: 'Совпало правило',
        reason: 'Письмо без вложений учтено в статистике по правилу'
      };
    }

    for (const attachment of attachments) {
      try {
        const attachmentNameFromHeader = attachment.name || '';
        const scopedMessage = {
          ...messageData,
          attachments: [{ name: attachmentNameFromHeader }]
        };
        const attachmentRules = matchedRules.filter(item => {
          try {
            return matchesAttachmentQuery(
              item.tree,
              scopedMessage,
              { name: attachmentNameFromHeader }
            );
          } catch (_) {
            return false;
          }
        });
        if (!attachmentRules.length) continue;
        hadAttachmentMatches = true;
        const effectiveRules = settings.stopAfterFirstMatch === true
          ? attachmentRules.slice(0, 1)
          : attachmentRules;

        if (!saveAttachments) {
          for (const item of effectiveRules) {
            const rule = item.rule;
            await logAttachment({
              accountName: meta.accountName,
              senderName: meta.senderName,
              senderEmail: meta.senderEmail,
              subject: messageHeader.subject || '',
              importance: messageData.importance || 'unknown',
              attachmentName: attachmentNameFromHeader,
              partName: attachment.partName || '',
              attachmentSize: Number(attachment.size || 0),
              ruleFolder: rule.folder || '',
              ruleName: rule.name || '',
              ruleQuery: rule.query || '',
              messageId,
              headerMessageId,
              receivedDate,
              receivedTime,
              status: 'pending'
            });
          }
          continue;
        }

        const file = await callMailApi('messages.getAttachmentFile', () =>
          messenger.messages.getAttachmentFile(messageId, attachment.partName)
        );
        for (const item of effectiveRules) {
          const rule = item.rule;
          const attachmentName = file.name || attachment.name || '';
          const relativeDir = buildRelativeDir(settings, rule, meta);
          const filename = `${relativeDir}/${sanitizePathPart(attachmentName || 'file')}`;
          const registryEntry = {
            messageId,
            partName: attachment.partName || '',
            attachmentName,
            attachmentSize: Number(file.size || attachment.size || 0),
            senderEmail: meta.senderEmail,
            subject: messageHeader.subject || '',
            receivedDate,
            accountName: meta.accountName,
            ruleFolder: rule.folder || '',
            savedAs: filename
          };
          const saveResult = await saveUniqueAttachment({
            file,
            fingerprint: buildExportFingerprint(registryEntry),
            entry: registryEntry,
            saveBuffer: buffer => saveAttachmentBuffer(buffer, filename)
          });
          await trace({
            operationId,
            area: 'save',
            stage: 'duplicate-decision',
            ok: saveResult.saved === true || !!saveResult.duplicateOf,
            details: {
              messageId,
              partName: attachment.partName || '',
              attachmentName,
              ruleName: rule.name || '',
              contentHash: saveResult.contentHash || '',
              saved: saveResult.saved === true,
              duplicateOf: saveResult.duplicateOf ? {
                messageId: saveResult.duplicateOf.messageId || '',
                attachmentName: saveResult.duplicateOf.attachmentName || '',
                savedAs: saveResult.duplicateOf.savedAs || '',
                downloadId: saveResult.duplicateOf.downloadId ?? null,
                fullPath: saveResult.duplicateOf.fullPath || ''
              } : null
            }
          });
          if (!saveResult.saved) {
            const duplicateOf = saveResult.duplicateOf || null;
            const isCurrentMessageSave = duplicateOf &&
              String(duplicateOf.messageId || '') === String(messageId) &&
              (duplicateOf.downloadId != null || String(duplicateOf.fullPath || '').trim());
            if (isCurrentMessageSave) {
              await logAttachment({
                accountName: meta.accountName,
                senderName: meta.senderName,
                senderEmail: meta.senderEmail,
                subject: messageHeader.subject || '',
                importance: messageData.importance || 'unknown',
                attachmentName,
                partName: attachment.partName || '',
                attachmentSize: Number(file.size || attachment.size || 0),
                contentHash: saveResult.contentHash,
                ruleFolder: rule.folder || '',
                ruleName: rule.name || '',
                ruleQuery: rule.query || '',
                downloadId: duplicateOf.downloadId ?? null,
                fullPath: duplicateOf.fullPath || '',
                savedAs: duplicateOf.savedAs || filename,
                messageId,
                headerMessageId,
                receivedDate,
                receivedTime,
                status: 'success'
              });
              alreadySaved += 1;
              continue;
            }
            hadDuplicates = true;
            if (duplicateOf) duplicateSources.push(duplicateOf);
            await logAttachment({
              accountName: meta.accountName,
              senderName: meta.senderName,
              senderEmail: meta.senderEmail,
              subject: messageHeader.subject || '',
              importance: messageData.importance || 'unknown',
              attachmentName,
              partName: attachment.partName || '',
              attachmentSize: Number(file.size || attachment.size || 0),
              contentHash: saveResult.contentHash,
              ruleFolder: rule.folder || '',
              ruleName: rule.name || '',
              ruleQuery: rule.query || '',
              messageId,
              headerMessageId,
              receivedDate,
              receivedTime,
              status: 'duplicate',
              duplicateOf
            });
            continue;
          }
          const { downloadId, fullPath } = saveResult.download;
          await trace({
            operationId,
            area: 'save',
            stage: 'download-completed',
            details: {
              messageId,
              partName: attachment.partName || '',
              attachmentName,
              ruleName: rule.name || '',
              downloadId,
              fullPath,
              savedAs: filename,
              contentHash: saveResult.contentHash
            }
          });
          await logAttachment({
            accountName: meta.accountName,
            senderName: meta.senderName,
            senderEmail: meta.senderEmail,
            subject: messageHeader.subject || '',
            importance: messageData.importance || 'unknown',
            attachmentName,
            partName: attachment.partName || '',
            attachmentSize: Number(file.size || attachment.size || 0),
            contentHash: saveResult.contentHash,
            ruleFolder: rule.folder || '',
            ruleName: rule.name || '',
            ruleQuery: rule.query || '',
            downloadId,
            fullPath,
            savedAs: filename,
            messageId,
            headerMessageId,
            receivedDate,
            receivedTime,
            status: 'success'
          });
          processed += 1;
        }
      } catch (error) {
        hadErrors = true;
        await logAttachment({
          accountName: meta.accountName,
          senderName: meta.senderName,
          senderEmail: meta.senderEmail,
          subject: messageHeader.subject || '',
          importance: messageData.importance || 'unknown',
          attachmentName: attachment.name || '',
          attachmentSize: Number(attachment.size || 0),
          ruleFolder: firstMatchedRule && firstMatchedRule.folder || '',
          ruleQuery: firstMatchedRule && firstMatchedRule.query || '',
          messageId,
          headerMessageId,
          receivedDate,
          receivedTime,
          status: 'error',
          error: String(error)
        });
      }
    }

    const uniqueDuplicateSources = [...new Map(duplicateSources.map(source => [[
      source.messageId,
      source.attachmentName,
      source.downloadId,
      source.savedAs
    ].join('|'), source])).values()];
    let auditStatus = 'Проверено';
    let auditReason = '';
    if (!saveAttachments && hadAttachmentMatches) {
      auditStatus = 'Ожидает сохранения';
      auditReason = 'Письмо и вложения совпали с правилом. Нажмите «Сохранить вложения» в результатах';
    } else if ((processed > 0 || alreadySaved > 0) && !hadErrors) {
      auditStatus = 'Обработано';
      auditReason = processed > 0
        ? 'Есть успешно сохраненные вложения'
        : 'Ранее сохранённые вложения восстановлены в статистике';
    } else if ((processed > 0 || alreadySaved > 0) && hadErrors) {
      auditStatus = 'Обработано частично';
      auditReason = 'Часть вложений сохранена, часть завершилась ошибкой';
    } else if (hadErrors) {
      auditStatus = 'Ошибка';
      auditReason = 'Совпавшие вложения не удалось обработать';
    } else if (hadDuplicates && !processed) {
      auditStatus = 'Пропущено как дубль';
      const source = uniqueDuplicateSources[0] || {};
      const sourceDetails = [
        source.subject ? `письмо «${source.subject}»` : 'другое письмо',
        source.receivedDate ? `от ${source.receivedDate}` : '',
        source.senderEmail ? `отправитель ${source.senderEmail}` : ''
      ].filter(Boolean).join(', ');
      auditReason = `Вложение уже сохранено из: ${sourceDetails}`;
    } else if (firstMatchedRule && !hadAttachmentMatches) {
      auditStatus = 'Совпало правило';
      auditReason = 'Письмо совпало по правилу, но ни одно вложение не подошло под условие вложения';
    } else if (firstMatchedRule) {
      auditStatus = 'Совпало правило';
      auditReason = 'Правило совпало, но новых вложений для сохранения не найдено';
    }

    await logMessageAudit({
      ...auditBase,
      ruleCheckedCount: applicableRules.length,
      matchedRuleQuery: firstMatchedRule && firstMatchedRule.query || '',
      matchedRuleFolder: firstMatchedRule && firstMatchedRule.folder || '',
      matchedRuleName: firstMatchedRule && firstMatchedRule.name || '',
      status: auditStatus,
      reason: auditReason,
      processedCount: processed + alreadySaved
    });
    await applyFeedback(messageId, auditStatus, messageHeader.subject || '', operationId);
    if (saveAttachments) {
      await trace({
        operationId,
        area: 'save',
        stage: 'completed',
        ok: !hadErrors,
        details: {
          messageId,
          processed,
          alreadySaved,
          hadDuplicates,
          hadErrors,
          auditStatus,
          duplicateSources: uniqueDuplicateSources.map(source => ({
            messageId: source.messageId || '',
            downloadId: source.downloadId ?? null,
            savedAs: source.savedAs || ''
          }))
        }
      });
    }
    return {
      checked: true,
      matched: Boolean(firstMatchedRule),
      processed,
      saved: processed,
      alreadySaved,
      duplicate: hadDuplicates && !processed,
      duplicateSources: duplicateSourcesForNotification(
        uniqueDuplicateSources,
        { messageId, saved: processed + alreadySaved }
      ),
      auditStatus,
      reason: auditReason
    };
  }

  async function processMessage(messageId, options = {}) {
    const saveAttachments = options.saveAttachments === true;
    const context = options.context || null;
    const logSink = options.logSink || null;
    return await processing.run(
      `${messageId}:${saveAttachments ? 'save' : 'scan'}`,
      async () => normalizeProcessingResult(await processCore(messageId, {
        saveAttachments,
        context,
        logAttachment: logSink ? logSink.logAttachment : undefined,
        logMessageAudit: logSink ? logSink.logMessageAudit : undefined
      }))
    );
  }

  return {
    processMessage,
    getMessageData,
    createRuntimeContext,
    invalidateRuntimeContext
  };
}
