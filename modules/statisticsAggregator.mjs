export const OUTCOME = Object.freeze({
  PROCESSED: 'processed',
  PARTIAL: 'partial',
  ERROR: 'error',
  DUPLICATE: 'duplicate',
  NO_ATTACHMENTS: 'no_attachments',
  NOT_MATCHED: 'not_matched',
  CHECKED: 'checked',
  NO_RULES: 'no_rules',
  MATCHED: 'matched',
  PENDING: 'pending',
  UNKNOWN: 'unknown'
});

export const OUTCOME_LABELS = Object.freeze({
  [OUTCOME.PROCESSED]: 'Обработано',
  [OUTCOME.PARTIAL]: 'Обработано частично',
  [OUTCOME.ERROR]: 'Ошибка',
  [OUTCOME.DUPLICATE]: 'Дубль',
  [OUTCOME.NO_ATTACHMENTS]: 'Нет вложений',
  [OUTCOME.NOT_MATCHED]: 'Не совпало',
  [OUTCOME.CHECKED]: 'Проверено',
  [OUTCOME.NO_RULES]: 'Нет правил',
  [OUTCOME.MATCHED]: 'Совпало правило',
  [OUTCOME.PENDING]: 'Ожидает сохранения',
  [OUTCOME.UNKNOWN]: 'Неизвестно'
});

export function classifyAuditStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  if (status === 'обработано') return OUTCOME.PROCESSED;
  if (status.includes('частично')) return OUTCOME.PARTIAL;
  if (status.includes('ошиб')) return OUTCOME.ERROR;
  if (status.includes('дубл')) return OUTCOME.DUPLICATE;
  if (status.includes('вложений нет') || status.includes('без вложений')) return OUTCOME.NO_ATTACHMENTS;
  if (status.includes('не подошло')) return OUTCOME.NOT_MATCHED;
  if (status.includes('нет правил')) return OUTCOME.NO_RULES;
  if (status.includes('совпало правило')) return OUTCOME.MATCHED;
  if (status.includes('ожидает сохранения')) return OUTCOME.PENDING;
  if (status.includes('проверено')) return OUTCOME.CHECKED;
  return OUTCOME.UNKNOWN;
}

export function dateToIso(value) {
  const text = String(value || '').trim();
  const match = text.match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/);
  if (match) {
    const year = match[3].length === 2 ? `20${match[3]}` : match[3];
    return `${year}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  }
  const timestamp = Date.parse(text);
  if (Number.isNaN(timestamp)) return '';
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function senderText(row) {
  return [row.senderName, row.senderEmail, row.sender].filter(Boolean).join(' ').trim();
}

function senderIdentity(row) {
  const email = String(row.senderEmail || '').trim().toLowerCase();
  return email || senderText(row).toLowerCase();
}

function auditDate(row) {
  return dateToIso(row.receivedDate || row.checkedDate || row.date);
}

function attachmentDate(row) {
  return dateToIso(row.receivedDate || row.date);
}

function latestAudits(auditLogs) {
  const latest = new Map();
  (Array.isArray(auditLogs) ? auditLogs : []).forEach((row, index) => {
    const messageId = String(row && row.messageId || '').trim();
    const key = messageId
      ? `mid:${messageId}`
      : `legacy:${row && row.accountName || ''}|${row && row.subject || ''}|${row && row.checkedDate || ''}|${index}`;
    const previous = latest.get(key);
    if (!previous || Number(row.timestamp || 0) >= Number(previous.timestamp || 0)) latest.set(key, row);
  });
  return [...latest.values()];
}

function normalizeImportance(value) {
  const importance = String(value || '').trim().toLowerCase();
  return ['high', 'normal', 'low'].includes(importance) ? importance : 'unknown';
}

function resolveImportance(auditValue, attachmentValue) {
  const auditImportance = normalizeImportance(auditValue);
  if (auditImportance !== 'unknown') return auditImportance;
  return normalizeImportance(attachmentValue);
}

function normalizedAudit(row, attachment = null) {
  let outcome = classifyAuditStatus(row.status);
  const hasSavedAttachments = Boolean(
    attachment && Number(attachment.savedCount || 0) > 0
  );
  if (
    outcome === OUTCOME.MATCHED &&
    /без вложений|нет вложений/i.test(String(row.reason || ''))
  ) {
    outcome = OUTCOME.NO_ATTACHMENTS;
  }
  if (
    attachment &&
    [OUTCOME.CHECKED, OUTCOME.NOT_MATCHED, OUTCOME.UNKNOWN].includes(outcome)
  ) {
    outcome = inferredAttachmentOutcome(attachment);
  }
  if (
    hasSavedAttachments &&
    [OUTCOME.PENDING, OUTCOME.DUPLICATE].includes(outcome)
  ) {
    outcome = OUTCOME.PROCESSED;
  }
  const ruleMatched = [
    OUTCOME.PROCESSED,
    OUTCOME.PARTIAL,
    OUTCOME.ERROR,
    OUTCOME.DUPLICATE,
    OUTCOME.NO_ATTACHMENTS,
    OUTCOME.MATCHED,
    OUTCOME.PENDING
  ].includes(outcome) || Boolean(attachment) || Boolean(
    row.matchedRuleName ||
    row.matchedRuleQuery ||
    row.matchedRuleFolder
  );
  return {
    ...row,
    reason: hasSavedAttachments && classifyAuditStatus(row.status) === OUTCOME.DUPLICATE
      ? 'Вложения этого письма уже сохранены'
      : row.reason,
    receivedDate: row.receivedDate || (attachment && attachment.receivedDate) || '',
    receivedTime: row.receivedTime || (attachment && attachment.receivedTime) || '',
    headerMessageId: row.headerMessageId || (attachment && attachment.headerMessageId) || '',
    importance: resolveImportance(
      row.importance,
      attachment && attachment.importance
    ),
    processedCount: attachment && Number.isFinite(Number(attachment.savedCount))
      ? Number(attachment.savedCount)
      : Number(row.processedCount || 0),
    canSaveAttachments: attachment
      ? attachment.canSaveAttachments === true
      : undefined,
    matchedAttachments: attachment && Array.isArray(attachment.matchedAttachments)
      ? attachment.matchedAttachments
      : [],
    matchedRules: attachment && Array.isArray(attachment.matchedRules) && attachment.matchedRules.length
      ? attachment.matchedRules
      : [{
          name: String(row.matchedRuleName || row.ruleName || ''),
          query: String(row.matchedRuleQuery || row.ruleQuery || ''),
          folder: String(row.matchedRuleFolder || row.ruleFolder || '')
        }].filter(rule => rule.name || rule.query || rule.folder),
    ruleMatched,
    outcome,
    outcomeLabel: OUTCOME_LABELS[outcome],
    ruleName: String(row.matchedRuleName || row.ruleName || (attachment && attachment.ruleName) || ''),
    ruleQuery: String(row.matchedRuleQuery || row.ruleQuery || (attachment && attachment.ruleQuery) || ''),
    ruleFolder: String(row.matchedRuleFolder || row.ruleFolder || (attachment && attachment.ruleFolder) || ''),
    eventDate: auditDate(row)
  };
}

function matchesFilters(row, filters, kind) {
  const sender = String(filters.sender || '').trim().toLowerCase();
  const ruleName = String(filters.ruleName || '').trim().toLowerCase();
  const accountName = String(filters.accountName || '').trim().toLowerCase();
  const dateFrom = String(filters.dateFrom || '').trim();
  const dateTo = String(filters.dateTo || '').trim();
  const status = String(filters.status || '').trim();
  const importance = String(filters.importance || '').trim().toLowerCase();
  const date = kind === 'audit' ? row.eventDate : attachmentDate(row);
  const rowRule = String(row.ruleName || row.matchedRuleName || '').trim().toLowerCase();
  const rowRules = new Set([
    rowRule,
    ...(Array.isArray(row.matchedRules) ? row.matchedRules : [])
      .map(rule => String(rule?.name || '').trim().toLowerCase())
      .filter(Boolean)
  ].filter(Boolean));
  const rowAccount = String(row.accountName || '').trim().toLowerCase();
  const dateOk = (!dateFrom || (date && date >= dateFrom)) && (!dateTo || (date && date <= dateTo));
  return (!sender || senderText(row).toLowerCase().includes(sender))
    && (!ruleName || rowRules.has(ruleName))
    && (!accountName || rowAccount === accountName)
    && (!importance || normalizeImportance(row.importance) === importance)
    && (!status || (status === 'attention'
      ? [OUTCOME.PARTIAL, OUTCOME.ERROR].includes(row.outcome)
      : row.outcome === status))
    && dateOk;
}

function inferredAttachmentOutcome(row) {
  if (row.status === 'partial') return OUTCOME.PARTIAL;
  if (row.status === 'success') return OUTCOME.PROCESSED;
  if (row.status === 'pending') return OUTCOME.PENDING;
  if (row.status === 'duplicate') return OUTCOME.DUPLICATE;
  if (row.status === 'no_attachment') return OUTCOME.NO_ATTACHMENTS;
  return OUTCOME.ERROR;
}

function attachmentRelationKey(row, index) {
  const messageId = String(row && row.messageId || '').trim();
  const part = String(row && (row.partName || row.attachmentName) || '').trim().toLowerCase();
  const rule = String(row && (row.ruleName || row.ruleFolder || row.ruleQuery) || '').trim().toLowerCase();
  if (messageId || part || rule) return `${messageId}|${part}|${rule}`;
  return `legacy:${row && row.id || index}`;
}

export function projectAttachmentStates(attachmentLogs = []) {
  const grouped = new Map();
  (Array.isArray(attachmentLogs) ? attachmentLogs : []).forEach((row, index) => {
    const key = attachmentRelationKey(row, index);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push({ ...row, __index: index });
  });

  return [...grouped.values()].map(rows => {
    const ordered = [...rows].sort((left, right) =>
      Number(right.timestamp || 0) - Number(left.timestamp || 0) ||
      right.__index - left.__index
    );
    const latest = ordered[0];
    const saved = ordered.find(row => row.status === 'success');
    const selected = saved && ['pending', 'duplicate', 'error'].includes(String(latest.status || ''))
      ? saved
      : latest;
    const { __index, ...state } = selected;
    return state;
  });
}

function summarizeAttachments(attachmentLogs) {
  const grouped = new Map();
  for (const row of (Array.isArray(attachmentLogs) ? attachmentLogs : [])) {
    const messageId = String(row && row.messageId || '').trim();
    if (!messageId) continue;
    if (!grouped.has(messageId)) grouped.set(messageId, []);
    grouped.get(messageId).push(row);
  }

  const summaries = new Map();
  for (const [messageId, rows] of grouped) {
    const newest = [...rows].sort(
      (left, right) => Number(right.timestamp || 0) - Number(left.timestamp || 0)
    )[0] || {};
    const knownImportance = rows
      .map(row => normalizeImportance(row.importance))
      .find(value => value !== 'unknown');
    const savedCount = rows.filter(
      row => row.status === 'success' && row.fileExists !== false
    ).length;
    const hasSuccess = savedCount > 0;
    const hasError = rows.some(row => row.status === 'error');
    const canSaveAttachments = rows.some(
      row =>
        ['pending', 'error'].includes(String(row.status || '')) ||
        (row.status === 'success' && row.fileExists === false)
    );
    const status = hasSuccess && hasError
      ? 'partial'
      : hasSuccess
        ? 'success'
        : hasError
        ? 'error'
          : rows.some(row => row.status === 'no_attachment')
            ? 'no_attachment'
            : newest.status;
    const valueFromRows = key =>
      String(newest[key] || '') ||
      String((rows.find(row => row && row[key]) || {})[key] || '');
    const attachmentGroups = new Map();
    rows
      .filter(row => String(row.attachmentName || '').trim())
      .forEach((row, index) => {
        const key = String(row.partName || row.contentHash || `${row.attachmentName}|${index}`);
        if (!attachmentGroups.has(key)) attachmentGroups.set(key, []);
        attachmentGroups.get(key).push(row);
      });
    const matchedAttachments = [...attachmentGroups.values()].map(group => {
      const selected = group.find(row => row.status === 'success') || group[group.length - 1];
      return {
        name: String(selected.attachmentName || ''),
        status: String(selected.status || ''),
        contentHash: String(selected.contentHash || ''),
        size: Number(selected.attachmentSize || 0)
      };
    });
    const matchedRules = [];
    const matchedRuleKeys = new Set();
    rows
      .filter(row => String(row.ruleName || row.ruleQuery || row.ruleFolder || '').trim())
      .forEach(row => {
        const name = String(row.ruleName || '').trim();
        const query = String(row.ruleQuery || '').trim();
        const folder = String(row.ruleFolder || '').trim();
        const key = name
          ? `name:${name.toLocaleLowerCase('ru')}`
          : `anonymous:${query.toLocaleLowerCase('ru')}|${folder.toLocaleLowerCase('ru')}`;
        if (matchedRuleKeys.has(key)) return;
        matchedRuleKeys.add(key);
        matchedRules.push({ name, query, folder });
      });

    summaries.set(messageId, {
      ...newest,
      messageId,
      status,
      savedCount,
      canSaveAttachments,
      matchedAttachments,
      matchedRules,
      importance: knownImportance || 'unknown',
      ruleName: valueFromRows('ruleName'),
      ruleQuery: valueFromRows('ruleQuery'),
      ruleFolder: valueFromRows('ruleFolder'),
      receivedDate: valueFromRows('receivedDate'),
      receivedTime: valueFromRows('receivedTime'),
      headerMessageId: valueFromRows('headerMessageId')
    });
  }
  return summaries;
}

function groupingLabel(row, key) {
  if (!key) return '—';
  if (key === 'sender') return senderText(row) || 'Не указан';
  if (key === 'importance') {
    return ({
      high: 'Высокая',
      normal: 'Обычная',
      low: 'Низкая',
      unknown: 'Не определена'
    })[normalizeImportance(row.importance)];
  }
  if (key === 'outcome') return row.outcomeLabel || OUTCOME_LABELS[row.outcome] || 'Неизвестно';
  if (key === 'ruleName') return row.ruleName || 'Без имени правила';
  if (key === 'ruleFolder') return row.ruleFolder || 'Не указана';
  if (key === 'eventDate') return row.eventDate || 'Дата не указана';
  return String(row[key] || '—');
}

export function groupStatisticsMessages(messages = [], primary = '', secondary = '') {
  if (!primary && !secondary) return [];
  const grouped = new Map();
  for (const row of (Array.isArray(messages) ? messages : [])) {
    const first = groupingLabel(row, primary);
    const second = groupingLabel(row, secondary);
    const key = JSON.stringify([first, second]);
    grouped.set(key, (grouped.get(key) || 0) + 1);
  }
  return [...grouped.entries()]
    .map(([key, count]) => {
      const [first, second] = JSON.parse(key);
      return { first, second, count };
    })
    .sort((left, right) =>
      right.count - left.count ||
      left.first.localeCompare(right.first, 'ru', { sensitivity: 'base', numeric: true }) ||
      left.second.localeCompare(right.second, 'ru', { sensitivity: 'base', numeric: true })
    );
}

export function aggregateStatistics({ auditLogs = [], attachmentLogs = [], filters = {} } = {}) {
  const attachmentStates = projectAttachmentStates(attachmentLogs);
  const attachmentByMessage = summarizeAttachments(attachmentStates);
  const latestAuditRows = latestAudits(auditLogs);
  const auditedMessageIds = new Set(
    latestAuditRows.map(row => String(row && row.messageId || '').trim()).filter(Boolean)
  );
  const syntheticAudits = [...attachmentByMessage.entries()]
    .filter(([messageId]) => !auditedMessageIds.has(messageId))
    .map(([messageId, attachment]) => ({
      ...attachment,
      messageId,
      status: attachment.status === 'partial'
        ? 'Обработано частично'
        : attachment.status === 'success'
          ? 'Обработано'
          : attachment.status === 'pending'
            ? 'Ожидает сохранения'
            : attachment.status === 'duplicate'
              ? 'Пропущено как дубль'
          : attachment.status === 'no_attachment'
            ? 'Совпало правило, вложений нет'
            : 'Ошибка',
      matchedRuleName: attachment.ruleName || '',
      matchedRuleQuery: attachment.ruleQuery || '',
      matchedRuleFolder: attachment.ruleFolder || '',
      processedCount: attachment.status === 'success' ? 1 : 0
    }));
  const messages = [...latestAuditRows, ...syntheticAudits]
    .filter(row =>
      String(row && row.messageId || '').trim() ||
      String(row && row.senderEmail || '').trim() ||
      String(row && row.subject || '').trim()
    )
    .map(row => normalizedAudit(
      row,
      attachmentByMessage.get(String(row && row.messageId || ''))
    ))
    .filter(row => matchesFilters(row, filters, 'audit'))
    .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));

  const auditByMessage = new Map(
    latestAudits(auditLogs)
      .map(row => normalizedAudit(
        row,
        attachmentByMessage.get(String(row && row.messageId || ''))
      ))
      .filter(row => row.messageId !== undefined && row.messageId !== null && row.messageId !== '')
      .map(row => [String(row.messageId), row])
  );
  const attachments = attachmentStates
    .map(row => {
      const audit = auditByMessage.get(String(row.messageId || ''));
      const outcome = audit ? audit.outcome : inferredAttachmentOutcome(row);
      return { ...row, outcome, outcomeLabel: OUTCOME_LABELS[outcome] };
    })
    .filter(row => matchesFilters(row, filters, 'attachment'))
    .filter(row => row.status === 'success' && row.fileExists !== false);

  const matchedMessages = messages.filter(row => row.ruleMatched);
  const processed = matchedMessages.filter(row => row.outcome === OUTCOME.PROCESSED).length;
  const partial = matchedMessages.filter(row => row.outcome === OUTCOME.PARTIAL).length;
  const errors = matchedMessages.filter(row => row.outcome === OUTCOME.ERROR).length;
  const rateDenominator = processed + partial + errors;
  const availableSavedRows = attachments;
  const uniqueSavedRows = [...new Map(availableSavedRows.map((row, index) => {
    const key = row.downloadId !== null && row.downloadId !== undefined
      ? `download:${row.downloadId}`
      : String(row.fullPath || '').trim()
        ? `path:${String(row.fullPath).trim().toLowerCase()}`
        : `legacy:${row.id || `${row.messageId || ''}|${row.partName || ''}|${row.attachmentName || ''}|${row.ruleFolder || ''}|${index}`}`;
    return [key, row];
  })).values()];
  const savedAttachments = uniqueSavedRows.length;
  const savedBytes = uniqueSavedRows
    .reduce((sum, row) => sum + Number(row.attachmentSize || 0), 0);
  const duplicateAttachments = (Array.isArray(attachmentLogs) ? attachmentLogs : [])
    .map(row => ({ ...row, outcome: OUTCOME.DUPLICATE }))
    .filter(row => row.status === 'duplicate')
    .filter(row => matchesFilters(row, filters, 'attachment')).length;

  return {
    messages,
    matchedMessages,
    attachments,
    kpi: {
      matchedMessages: matchedMessages.length,
      processedMessages: processed,
      savedAttachments,
      attention: partial + errors,
      duplicates: Math.max(
        duplicateAttachments,
        matchedMessages.filter(row => row.outcome === OUTCOME.DUPLICATE).length
      ),
      noAttachments: matchedMessages.filter(row => row.outcome === OUTCOME.NO_ATTACHMENTS).length,
      uniqueSenders: new Set(matchedMessages.map(senderIdentity).filter(Boolean)).size,
      savedBytes,
      successRate: rateDenominator ? Math.round((processed / rateDenominator) * 1000) / 10 : null
    },
    options: {
      ruleNames: [...new Set([
        ...matchedMessages.map(row => String(row.ruleName || '')).filter(Boolean),
        ...matchedMessages.flatMap(row =>
          (Array.isArray(row.matchedRules) ? row.matchedRules : [])
            .map(rule => String(rule?.name || ''))
            .filter(Boolean)
        ),
        ...attachmentStates.map(row => String(row.ruleName || '')).filter(Boolean)
      ])].sort((a, b) => a.localeCompare(b, 'ru')),
      accountNames: [...new Set([
        ...matchedMessages.map(row => String(row.accountName || '')).filter(Boolean),
        ...attachmentStates.map(row => String(row.accountName || '')).filter(Boolean)
      ])].sort((a, b) => a.localeCompare(b, 'ru'))
    }
  };
}
