import {
  getArray as storageGetArray,
  appendToArray,
  appendManyToArray,
  setArray as storageSetArray,
  update as storageUpdate
} from './storageManager.mjs';

const ATTACHMENT_LOGS_KEY = 'attachmentLogs';
const MESSAGE_AUDIT_LOGS_KEY = 'messageAuditLogs';
const RETRY_LOGS_KEY = 'retryLogs';
const RULE_TEST_LOGS_KEY = 'ruleTestLogs';
const ATTACHMENT_LOGS_LIMIT = 20000;
const MESSAGE_AUDIT_LOGS_LIMIT = 20000;

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

async function getArray(key) {
  return await storageGetArray(key);
}

async function setArray(key, value) {
  await storageSetArray(key, value);
}

function buildAttachmentLogEntry(data) {
  const now = new Date();
  const senderName = data.senderName || data.sender_name || '';
  const senderEmail = data.senderEmail || data.sender_email || '';

  return {
    id: generateId(),
    date: now.toLocaleDateString(),
    time: now.toLocaleTimeString(),
    timestamp: now.getTime(),

    accountName: data.accountName || '',

    sender: senderName
      ? `${senderName}${senderEmail ? ` <${senderEmail}>` : ''}`
      : senderEmail,

    senderName,
    senderEmail,

    subject: data.subject || 'Без темы',
    body: data.body || '',

    importance: ['high', 'normal', 'low'].includes(String(data.importance || '').toLowerCase())
      ? String(data.importance).toLowerCase()
      : 'unknown',

    attachmentName: data.attachmentName || '',
    partName: data.partName || '',
    attachmentSize: Number(data.attachmentSize || 0),
    contentHash: data.contentHash || '',

    ruleFolder: data.ruleFolder || '',
    ruleName: data.ruleName || '',
    ruleQuery: data.ruleQuery || '',

    messageId: data.messageId || '',
    headerMessageId: data.headerMessageId || '',
    receivedDate: data.receivedDate || '',
    receivedTime: data.receivedTime || '',

    downloadId: data.downloadId ?? null,
    fullPath: data.fullPath || '',
    savedAs: data.savedAs || '',

    status: data.status || 'success',
    error: data.error || '',
    duplicateOf: data.duplicateOf || null
  };
}

function attachmentDedupKey(entry) {
  return [
    entry.messageId,
    entry.senderEmail,
    entry.subject,
    entry.receivedDate,
    entry.receivedTime,
    entry.attachmentName,
    entry.partName,
    entry.attachmentSize,
    entry.ruleFolder,
    entry.ruleName,
    entry.ruleQuery,
    entry.downloadId ?? '',
    entry.status
  ].map(value => String(value ?? '')).join('||');
}

export async function logAttachment(data) {
  try {
    const logEntry = buildAttachmentLogEntry(data);
    const key = attachmentDedupKey(logEntry);
    await storageUpdate(ATTACHMENT_LOGS_KEY, current => {
      const logs = Array.isArray(current) ? current : [];
      const duplicate = logs.some(row => attachmentDedupKey(row) === key);
      return duplicate ? logs : [...logs, logEntry].slice(-ATTACHMENT_LOGS_LIMIT);
    }, []);
  } catch (e) {
    console.error('Failed to log attachment:', e);
  }
}

export async function getAttachmentLogs() {
  try {
    return await getArray(ATTACHMENT_LOGS_KEY);
  } catch (e) {
    console.error('Failed to get attachment logs:', e);
    return [];
  }
}

export async function clearAttachmentLogs() {
  try {
    await setArray(ATTACHMENT_LOGS_KEY, []);
  } catch (e) {
    console.error('Failed to clear attachment logs:', e);
  }
}

function buildAuditLogEntry(data) {
  const now = new Date();
  return {
    id: generateId(),
    timestamp: now.getTime(),
    checkedDate: data.checkedDate || now.toLocaleDateString(),
    checkedTime: data.checkedTime || now.toLocaleTimeString(),
    receivedDate: data.receivedDate || '',
    receivedTime: data.receivedTime || '',
    importance: ['high', 'normal', 'low'].includes(String(data.importance || '').toLowerCase())
      ? String(data.importance).toLowerCase()
      : 'unknown',
    accountName: data.accountName || '',
    senderName: data.senderName || '',
    senderEmail: data.senderEmail || '',
    subject: data.subject || '',
    messageId: data.messageId || '',
    headerMessageId: data.headerMessageId || '',
    ruleCheckedCount: Number(data.ruleCheckedCount || 0),
    matchedRuleQuery: data.matchedRuleQuery || '',
    matchedRuleFolder: data.matchedRuleFolder || '',
    matchedRuleName: data.matchedRuleName || '',
    status: data.status || '',
    reason: data.reason || '',
    processedCount: Number(data.processedCount || 0)
  };
}

export async function logMessageAudit(data) {
  try {
    await appendToArray(MESSAGE_AUDIT_LOGS_KEY, buildAuditLogEntry(data), MESSAGE_AUDIT_LOGS_LIMIT);
  } catch (e) {
    console.error('Failed to log message audit:', e);
  }
}

// Buffers log entries in memory; flush() writes them in one batch instead of one storage write per entry.
export function createLogBatcher() {
  let pendingAttachments = [];
  let pendingAudits = [];

  async function logAttachment(data) {
    pendingAttachments.push(buildAttachmentLogEntry(data));
  }

  async function logMessageAudit(data) {
    pendingAudits.push(buildAuditLogEntry(data));
  }

  async function flush() {
    if (!pendingAttachments.length && !pendingAudits.length) return;
    const attachmentsToFlush = pendingAttachments;
    const auditsToFlush = pendingAudits;
    pendingAttachments = [];
    pendingAudits = [];

    if (attachmentsToFlush.length) {
      await storageUpdate(ATTACHMENT_LOGS_KEY, current => {
        const logs = Array.isArray(current) ? current : [];
        const seen = new Set(logs.map(attachmentDedupKey));
        const merged = logs.slice();
        for (const entry of attachmentsToFlush) {
          const key = attachmentDedupKey(entry);
          if (seen.has(key)) continue;
          seen.add(key);
          merged.push(entry);
        }
        return merged.slice(-ATTACHMENT_LOGS_LIMIT);
      }, []);
    }

    if (auditsToFlush.length) {
      await appendManyToArray(MESSAGE_AUDIT_LOGS_KEY, auditsToFlush, MESSAGE_AUDIT_LOGS_LIMIT);
    }
  }

  return { logAttachment, logMessageAudit, flush };
}

export async function getMessageAuditLogs() {
  try {
    return await getArray(MESSAGE_AUDIT_LOGS_KEY);
  } catch (e) {
    console.error('Failed to get message audit logs:', e);
    return [];
  }
}

export async function clearMessageAuditLogs() {
  try {
    await setArray(MESSAGE_AUDIT_LOGS_KEY, []);
  } catch (e) {
    console.error('Failed to clear message audit logs:', e);
  }
}

export async function logRetry(data) {
  try {
    const now = new Date();

    await appendToArray(RETRY_LOGS_KEY, {
      id: generateId(),
      timestamp: now.getTime(),
      date: now.toLocaleDateString(),
      time: now.toLocaleTimeString(),
      messageId: data.messageId || '',
      beforeStatus: data.beforeStatus || '',
      afterStatus: data.afterStatus || '',
      addedCount: Number(data.addedCount || 0),
      error: data.error || ''
    }, 5000);
  } catch (e) {
    console.error('Failed to log retry:', e);
  }
}

export async function getRetryLogs() {
  try {
    return await getArray(RETRY_LOGS_KEY);
  } catch (e) {
    console.error('Failed to get retry logs:', e);
    return [];
  }
}

export async function clearRetryLogs() {
  try {
    await setArray(RETRY_LOGS_KEY, []);
  } catch (e) {
    console.error('Failed to clear retry logs:', e);
  }
}

export async function logRuleTest(data) {
  try {
    const now = new Date();

    await appendToArray(RULE_TEST_LOGS_KEY, {
      id: generateId(),
      timestamp: now.getTime(),
      date: now.toLocaleDateString(),
      time: now.toLocaleTimeString(),
      accountName: data.accountName || '',
      messagesChecked: Number(data.messagesChecked || 0),
      rulesChecked: Number(data.rulesChecked || 0)
    }, 2000);
  } catch (e) {
    console.error('Failed to log rule test:', e);
  }
}

export async function getRuleTestLogs() {
  try {
    return await getArray(RULE_TEST_LOGS_KEY);
  } catch (e) {
    console.error('Failed to get rule test logs:', e);
    return [];
  }
}

export async function clearRuleTestLogs() {
  try {
    await setArray(RULE_TEST_LOGS_KEY, []);
  } catch (e) {
    console.error('Failed to clear rule test logs:', e);
  }
}
