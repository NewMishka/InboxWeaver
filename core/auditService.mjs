import { getMessageAuditLogs } from '../modules/statisticsManager.mjs';

export async function latestAuditFor(messageId) {
  const logs = await getMessageAuditLogs();
  const rows = logs.filter(
    row => String(row.messageId) === String(messageId)
  );

  if (!rows.length) return null;

  rows.sort(
    (left, right) =>
      (right.timestamp || 0) - (left.timestamp || 0)
  );
  return rows[0];
}
