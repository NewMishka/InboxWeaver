export function createRetryService({
  processMessage,
  latestAudit,
  logRetry,
  getAuditLogs
}) {
  async function retryMessages(messageIds) {
    const ids = [...new Set((messageIds || []).map(value => String(value)).filter(Boolean))];
    let retried = 0;
    let added = 0;
    let stillFailed = 0;
    for (const id of ids) {
      const before = await latestAudit(id);
      const beforeStatus = before ? before.status : '';
      let result = { processed: 0 };
      let errorText = '';
      try {
        result = await processMessage(Number(id));
      } catch (error) {
        errorText = String(error);
      }
      const after = await latestAudit(id);
      const afterStatus = after ? after.status : (errorText ? 'Ошибка' : '');
      const addedCount = Number(result && result.processed || 0);
      const auditError = after &&
        (after.status === 'Ошибка' || after.status === 'Обработано частично')
        ? (after.reason || '')
        : '';
      await logRetry({
        messageId: id,
        beforeStatus,
        afterStatus,
        addedCount,
        error: errorText || auditError
      });
      retried += 1;
      added += addedCount;
      if (afterStatus === 'Ошибка' || afterStatus === 'Обработано частично') stillFailed += 1;
    }
    return { retried, added, stillFailed };
  }

  async function retryFailedMessages() {
    const logs = await getAuditLogs();
    const latestByMessage = new Map();
    for (const row of logs) {
      if (!row.messageId) continue;
      const key = String(row.messageId);
      const current = latestByMessage.get(key);
      if (!current || Number(row.timestamp || 0) > Number(current.timestamp || 0)) {
        latestByMessage.set(key, row);
      }
    }
    const ids = [...latestByMessage.entries()]
      .filter(([, row]) => row.status === 'Ошибка' || row.status === 'Обработано частично')
      .map(([id]) => id);
    return retryMessages(ids);
  }

  return { retryMessages, retryFailedMessages };
}
