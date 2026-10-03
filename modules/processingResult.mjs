export const PROCESSING_STATUS = Object.freeze({
  NO_RULES: 'no_rules',
  NOT_MATCHED: 'not_matched',
  MATCHED: 'matched',
  PENDING: 'pending',
  NO_ATTACHMENTS: 'no_attachments',
  PROCESSED: 'processed',
  PARTIAL: 'partial',
  DUPLICATE: 'duplicate',
  ERROR: 'error',
  TIMEOUT: 'timeout',
  CHECKED: 'checked'
});

function inferStatus(result) {
  if (result.timeout) return PROCESSING_STATUS.TIMEOUT;
  if (result.error) return PROCESSING_STATUS.ERROR;

  const auditStatus = String(result.auditStatus || '').toLowerCase();
  if (auditStatus.includes('нет правил')) return PROCESSING_STATUS.NO_RULES;
  if (auditStatus.includes('дубл')) return PROCESSING_STATUS.DUPLICATE;
  if (auditStatus.includes('частично')) return PROCESSING_STATUS.PARTIAL;
  if (auditStatus.includes('ошиб')) return PROCESSING_STATUS.ERROR;
  if (auditStatus.includes('вложений нет')) return PROCESSING_STATUS.NO_ATTACHMENTS;
  if (auditStatus.includes('не подошло')) return PROCESSING_STATUS.NOT_MATCHED;
  if (auditStatus.includes('ожидает сохранения')) return PROCESSING_STATUS.PENDING;
  if (
    Number(result.saved || 0) > 0 ||
    Number(result.processed || 0) > 0 ||
    Number(result.alreadySaved || 0) > 0
  ) return PROCESSING_STATUS.PROCESSED;
  if (result.matched) return PROCESSING_STATUS.MATCHED;
  return PROCESSING_STATUS.CHECKED;
}

export function normalizeProcessingResult(value = {}) {
  const result = value && typeof value === 'object' ? value : {};
  const status = Object.values(PROCESSING_STATUS).includes(result.status)
    ? result.status
    : inferStatus(result);
  const error = result.error ? String(result.error) : '';

  return {
    ...result,
    contractVersion: 1,
    status,
    checked: result.checked === true,
    matched: result.matched === true,
    processed: Math.max(0, Number(result.processed || 0)),
    saved: Math.max(0, Number(result.saved || 0)),
    alreadySaved: Math.max(0, Number(result.alreadySaved || 0)),
    duplicate: status === PROCESSING_STATUS.DUPLICATE || result.duplicate === true,
    timeout: status === PROCESSING_STATUS.TIMEOUT || result.timeout === true,
    error,
    auditStatus: String(result.auditStatus || ''),
    reason: String(result.reason || '')
  };
}

export function duplicateSourcesForNotification(
  sources = [],
  { messageId = '', saved = 0 } = {}
) {
  const currentMessageId = String(messageId || '');
  const savedCount = Math.max(0, Number(saved || 0));
  return (Array.isArray(sources) ? sources : []).filter(source => {
    if (!source) return false;
    const isCurrentMessage =
      currentMessageId &&
      String(source.messageId || '') === currentMessageId;
    return !(savedCount > 0 && isCurrentMessage);
  });
}
