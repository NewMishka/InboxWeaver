import { update as storageUpdate } from './storageManager.mjs';

export const DEVELOPER_LOG_KEY = 'developerLogs';
export const DEVELOPER_LOG_LIMIT = 1000;
export const DIAGNOSTIC_SNAPSHOT_VERSION = 1;

export function createOperationId(prefix = 'op') {
  const random = globalThis.crypto?.randomUUID?.() ||
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `${String(prefix || 'op')}-${random}`;
}

function safeValue(value, depth = 0) {
  if (depth > 4) return '[max-depth]';
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string') return value.slice(0, 1000);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map(item => safeValue(item, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !['body', 'content', 'buffer', 'bytes'].includes(key))
        .slice(0, 50)
        .map(([key, item]) => [key, safeValue(item, depth + 1)])
    );
  }
  return String(value).slice(0, 1000);
}

export function normalizeDeveloperEvent(event = {}, now = Date.now()) {
  return {
    timestamp: now,
    isoTime: new Date(now).toISOString(),
    operationId: String(event.operationId || ''),
    area: String(event.area || 'general'),
    stage: String(event.stage || 'event'),
    ok: event.ok !== false,
    details: safeValue(event.details || {})
  };
}

export async function logDeveloperEvent(event, storageUpdateFn = storageUpdate) {
  const row = normalizeDeveloperEvent(event);
  await storageUpdateFn(
    DEVELOPER_LOG_KEY,
    current => [...(Array.isArray(current) ? current : []), row].slice(-DEVELOPER_LOG_LIMIT),
    []
  );
  return row;
}

function countRows(value) {
  return Array.isArray(value) ? value.length : 0;
}

const SNAPSHOT_REDACTED_KEYS = new Set([
  'fullPath',
  'filename',
  'folderPath',
  'savedAs',
  'attachmentName',
  'sender',
  'senderEmail',
  'senderName',
  'accountId',
  'accountName',
  'selectedAccounts',
  'ruleName',
  'ruleQuery',
  'ruleFolder'
]);

function redactText(value) {
  return String(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '<email>')
    .slice(0, 1000);
}

function snapshotValue(value, key = '', depth = 0) {
  if (depth > 4) return '[max-depth]';
  if (SNAPSHOT_REDACTED_KEYS.has(key)) return '[redacted]';
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string') return redactText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map(item => snapshotValue(item, '', depth + 1));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([itemKey]) => !['body', 'content', 'buffer', 'bytes'].includes(itemKey))
        .slice(0, 50)
        .map(([itemKey, item]) => [
          itemKey,
          snapshotValue(item, itemKey, depth + 1)
        ])
    );
  }
  return redactText(value);
}

export function buildDiagnosticSnapshot({
  exportedAt = new Date().toISOString(),
  pluginVersion = '',
  session = {},
  storage = {},
  tagDiagnostics = {},
  statisticsDiagnostics = {},
  entries = []
} = {}) {
  const settings = storage.settings || {};
  const storedEntries = Array.isArray(entries) ? entries : [];
  const exportedEntries = storedEntries
    .filter(row => String(row?.area || '') !== 'scan')
    .slice(-DEVELOPER_LOG_LIMIT)
    .map(row => snapshotValue(row));
  return {
    snapshotVersion: DIAGNOSTIC_SNAPSHOT_VERSION,
    exportedAt: String(exportedAt),
    pluginVersion: String(pluginVersion),
    session: snapshotValue(session),
    configuration: {
      liveMode: settings.liveMode !== false,
      stopAfterFirstMatch: settings.stopAfterFirstMatch === true,
      enableTags: settings.enableTags !== false,
      enableNotifications: settings.enableNotifications !== false,
      selectedAccountsCount: countRows(settings.selectedAccounts)
    },
    storageCounts: {
      rules: countRows(storage.rules),
      attachmentLogs: countRows(storage.attachmentLogs),
      messageAuditLogs: countRows(storage.messageAuditLogs),
      retryLogs: countRows(storage.retryLogs),
      ruleTestLogs: countRows(storage.ruleTestLogs),
      viewedMessages: countRows(storage.viewedMessages),
      exportRegistry: countRows(storage.exportRegistry),
      developerLogs: countRows(storedEntries)
    },
    entrySummary: {
      stored: storedEntries.length,
      exported: exportedEntries.length,
      legacyScanOmitted: storedEntries.length - exportedEntries.length
    },
    exportState: snapshotValue(storage.exportState || {}),
    resetDiagnostics: snapshotValue(storage.resetDiagnostics || null),
    tagDiagnostics: snapshotValue(tagDiagnostics),
    statisticsDiagnostics: snapshotValue(statisticsDiagnostics),
    entries: exportedEntries
  };
}
