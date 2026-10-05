import {
  getAttachmentLogs,
  getMessageAuditLogs,
  logAttachment,
  logMessageAudit,
  logRetry,
  logRuleTest,
  createLogBatcher
} from './modules/statisticsManager.mjs';
import { listAccounts, listFolders } from './modules/mailUtils.mjs';
import { getRules, getSettings } from './core/settingsService.mjs';
import {
  applyResultFeedback,
  clearMessageTags,
  diagnoseTags
} from './core/tagService.mjs';
import { latestAuditFor } from './core/auditService.mjs';
import { deleteDownloadedFiles } from './core/downloadService.mjs';
import { reconcileExportRegistry } from './modules/duplicateManager.mjs';
import { validateRuleDefinitions } from './modules/ruleValidator.mjs';
import { saveUniqueAttachment } from './modules/attachmentSaveService.mjs';
import {
  queryDownloadItemsForLogs,
  reconcileAttachmentAvailability
} from './modules/attachmentAvailability.mjs';
import { update as storageUpdate } from './modules/storageManager.mjs';
import { createMessageProcessingService } from './core/messageProcessingService.mjs';
import { createStartupCatchupService } from './core/startupCatchupService.mjs';
import { createForceExportService } from './core/forceExportService.mjs';
import { createRuleTestService } from './core/ruleTestService.mjs';
import { createRetryService } from './core/retryService.mjs';
import { createAutoReportService } from './core/autoReportService.mjs';
import { registerRuntimeRouter } from './core/runtimeRouter.mjs';
import {
  createOperationId,
  logDeveloperEvent
} from './modules/developerLog.mjs';

const sessionId = createOperationId('session');

const messageProcessing = createMessageProcessingService({
  messenger,
  getRules,
  getSettings,
  listAccounts,
  logAttachment,
  logMessageAudit,
  applyResultFeedback,
  saveUniqueAttachment
});

const processMessageById = (messageId, options = {}) =>
  messageProcessing.processMessage(messageId, options);
let autoReport = null;

if (messenger.storage && messenger.storage.onChanged) {
  messenger.storage.onChanged.addListener(changes => {
    if (changes.rules || changes.settings) {
      messageProcessing.invalidateRuntimeContext();
    }
    if (changes.settings && autoReport) autoReport.schedule().catch(() => {});
  });
}

async function updateExportState(patch) {
  return await storageUpdate(
    'exportState',
    current => ({ ...(current || {}), ...(patch || {}) }),
    {}
  );
}

const forceExport = createForceExportService({
  messenger,
  getRules,
  getSettings,
  processMessage: (messageId, options) => processMessageById(messageId, options),
  updateState: updateExportState,
  createLogBatcher
});

async function processSelectedMessages(selectedMessages, { saveAttachments = false } = {}) {
  let processed = 0;
  let saved = 0;
  const context = await messageProcessing.createRuntimeContext();
  for (const message of (selectedMessages && selectedMessages.messages || [])) {
    const result = await processMessageById(message.id, { saveAttachments, context });
    processed += Number(result && result.processed || 0);
    saved += Number(result && result.saved || 0);
  }
  if (saved > 0) {
    messenger.notifications.create({
      type: 'basic',
      title: 'Менеджер писем',
      message: `Обработано вложений: ${saved}`
    });
  } else if (processed > 0) {
    messenger.notifications.create({
      type: 'basic',
      title: 'Менеджер писем',
      message: 'Новых вложений не найдено'
    });
  }
  return saved;
}

async function createMenu() {
  try {
    await messenger.menus.removeAll();
  } catch (_) {}
  messenger.menus.create({
    id: 'save-attachments-by-rules',
    title: 'Сохранить вложения по правилам',
    contexts: ['message_list']
  });
}

messenger.menus.onClicked.addListener(async info => {
  if (info.menuItemId === 'save-attachments-by-rules') {
    await processSelectedMessages(info.selectedMessages, { saveAttachments: true });
  }
});

const startupCatchup = createStartupCatchupService({
  messenger,
  getSettings,
  getRules,
  processMessage: messageId => processMessageById(messageId),
  logAudit: logMessageAudit
});

messenger.messages.onNewMailReceived.addListener(async (_folder, messages) => {
  const settings = await getSettings();
  if (!settings.liveMode) return;
  await processSelectedMessages(messages, { saveAttachments: false });
  await startupCatchup.recordObservation();
});

const ruleTest = createRuleTestService({
  messenger,
  getRules,
  getMessageData: messageProcessing.getMessageData,
  logRuleTest
});

const retry = createRetryService({
  processMessage: messageId => processMessageById(messageId),
  latestAudit: latestAuditFor,
  logRetry,
  getAuditLogs: getMessageAuditLogs
});

autoReport = createAutoReportService({
  messenger,
  getSettings,
  getAttachmentLogs,
  getMessageAuditLogs
});

if (messenger.alarms && messenger.alarms.onAlarm) {
  messenger.alarms.onAlarm.addListener(alarm => {
    autoReport.handleAlarm(alarm).catch(error => logDeveloperEvent({
      operationId: createOperationId('auto-report'),
      area: 'auto-report',
      stage: 'failed',
      ok: false,
      details: { error: String(error) }
    }).catch(() => {}));
  });
}

async function validateRules() {
  const { rules = [] } = await messenger.storage.local.get({ rules: [] });
  return validateRuleDefinitions(rules);
}

async function getReconciledAttachmentLogs() {
  const logs = await getAttachmentLogs();
  const downloads = await queryDownloadItemsForLogs(
    logs,
    query => messenger.downloads.search(query)
  );
  return reconcileAttachmentAvailability(logs, downloads);
}

registerRuntimeRouter(messenger.runtime, {
  diagnoseTags: async () => {
    const operationId = createOperationId('tags');
    try {
      const result = await diagnoseTags();
      await logDeveloperEvent({
        operationId,
        area: 'tags',
        stage: 'diagnostics',
        ok: !result.error && result.created,
        details: result
      });
      return result;
    } catch (error) {
      await logDeveloperEvent({
        operationId,
        area: 'tags',
        stage: 'diagnostics',
        ok: false,
        details: { error: String(error) }
      });
      throw error;
    }
  },
  validateRules: () => validateRules(),
  validateRuleDefinitions: message => validateRuleDefinitions(message.rules || []),
  testRulesOnMessages: message => ruleTest.testRules(message),
  retryMessages: message => retry.retryMessages(message.messageIds || []),
  retryFailedMessages: () => retry.retryFailedMessages(),
  getAccounts: () => listAccounts().then(accounts =>
    accounts.map(account => ({ id: account.id, name: account.name }))
  ),
  getFolders: () => listFolders().then(items => items.map(item => ({
    accountId: item.accountId,
    accountName: item.accountName,
    path: item.path,
    displayPath: item.displayPath,
    key: item.key
  }))),
  getManifestInfo: () => Promise.resolve(messenger.runtime.getManifest()),
  getDiagnosticContext: async () => {
    const [platform, browserInfo, tags] = await Promise.all([
      messenger.runtime.getPlatformInfo
        ? messenger.runtime.getPlatformInfo().catch(() => null)
        : Promise.resolve(null),
      messenger.runtime.getBrowserInfo
        ? messenger.runtime.getBrowserInfo().catch(() => null)
        : Promise.resolve(null),
      diagnoseTags().catch(error => ({ error: String(error) }))
    ]);
    return { sessionId, platform, browserInfo, tags };
  },
  deleteDownloadedFiles: message => deleteDownloadedFiles(
    message.files || [],
    messenger.downloads,
    { operationId: message.operationId || '' }
  ),
  clearMessageTags: message => clearMessageTags(message.messageIds || []),
  openDownload: message => {
    if (message.downloadId) return messenger.downloads.show(message.downloadId);
    if (message.fileUrl) return messenger.tabs.create({ url: message.fileUrl });
    return Promise.reject(new Error('download target is not available'));
  },
  openMessage: message => {
    if (messenger.messageDisplay && messenger.messageDisplay.open) {
      return messenger.messageDisplay.open({ messageId: message.messageId });
    }
    return Promise.reject(new Error('messageDisplay.open is not supported in this build'));
  },
  processSelectedNow: message =>
    processSelectedMessages(message.selectedMessages, { saveAttachments: false }),
  saveMessageAttachments: message =>
    processMessageById(message.messageId, { saveAttachments: true }),
  forceExportExistingMessages: () => Promise.resolve(forceExport.start()),
  stopForceExport: () => Promise.resolve(forceExport.stop()),
  getExportState: () =>
    messenger.storage.local.get({ exportState: {} }).then(state => {
      const running = forceExport.running;
      return {
        ...(state.exportState || {}),
        running,
        stopping: running ? (state.exportState || {}).stopping === true : false,
        ...(running ? forceExport.currentActivity : {})
      };
    }),
  getReconciledAttachmentLogs: () => getReconciledAttachmentLogs(),
  openMessageById: message => {
    if (message.messageId && messenger.messageDisplay && messenger.messageDisplay.open) {
      return messenger.messageDisplay.open({ messageId: message.messageId });
    }
    return Promise.resolve();
  },
  composeNew: message => {
    if (messenger.compose && messenger.compose.beginNew) {
      return messenger.compose.beginNew(message.to ? { to: message.to } : {});
    }
    if (messenger.tabs && messenger.tabs.create && message.to) {
      return messenger.tabs.create({ url: 'mailto:' + encodeURIComponent(message.to) });
    }
    return Promise.reject(new Error('compose is not supported in this build'));
  },
  openFileLocation: message => {
    if (message.downloadId) return messenger.downloads.show(message.downloadId);
    return Promise.resolve();
  }
});

createMenu();
autoReport.schedule().catch(() => {});
startupCatchup.run();
startupCatchup.startHeartbeat();

reconcileExportRegistry(query => messenger.downloads.search(query))
  .then(result => logDeveloperEvent({
    operationId: sessionId,
    area: 'registry',
    stage: 'reconciled',
    ok: true,
    details: result
  }))
  .catch(error => logDeveloperEvent({
    operationId: sessionId,
    area: 'registry',
    stage: 'reconcile-failed',
    ok: false,
    details: { error: String(error) }
  }).catch(() => {}));

Promise.all([
  messenger.runtime.getPlatformInfo
    ? messenger.runtime.getPlatformInfo().catch(() => null)
    : Promise.resolve(null),
  messenger.runtime.getBrowserInfo
    ? messenger.runtime.getBrowserInfo().catch(() => null)
    : Promise.resolve(null)
]).then(([platform, browserInfo]) => logDeveloperEvent({
  operationId: sessionId,
  area: 'session',
  stage: 'started',
  details: {
    pluginVersion: messenger.runtime.getManifest().version,
    platform,
    browserInfo
  }
})).catch(() => {});
