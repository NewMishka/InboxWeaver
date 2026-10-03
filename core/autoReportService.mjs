import { aggregateStatistics } from '../modules/statisticsAggregator.mjs';
import { hydrateMessageHeaderIds, messageReportRows } from '../modules/messageReport.mjs';
import { multiSheetXlsxBlob } from '../modules/xlsx.mjs';

export const AUTO_REPORT_ALARM = 'inbox-weaver-auto-report';
export const AUTO_REPORT_INTERVALS = Object.freeze([30, 60, 360, 720, 1440, 10080]);

export function normalizeAutoReportInterval(value, fallback = 1440) {
  const interval = Number(value);
  return AUTO_REPORT_INTERVALS.includes(interval) ? interval : fallback;
}

function safePathPart(value) {
  return String(value || '')
    .replace(/^([A-Za-z]:)?[\\/]+/, '')
    .replace(/\.\.+/g, '')
    .replace(/[<>:"|?*\x00-\x1F]/g, '_')
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');
}

export function scheduledReportFilename(basePath, now = new Date()) {
  const root = safePathPart(basePath) || 'Вложения';
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return `${root}/Отчёты/Автоотчёт_${stamp}.xlsx`;
}

export function createAutoReportService({
  messenger,
  getSettings,
  getAttachmentLogs,
  getMessageAuditLogs,
  now = () => new Date()
}) {
  async function schedule() {
    const settings = await getSettings();
    await messenger.alarms.clear(AUTO_REPORT_ALARM);
    if (!settings.autoReportEnabled) return { enabled: false };
    const periodInMinutes = normalizeAutoReportInterval(settings.autoReportIntervalMinutes);
    messenger.alarms.create(AUTO_REPORT_ALARM, {
      delayInMinutes: periodInMinutes,
      periodInMinutes
    });
    return { enabled: true, periodInMinutes };
  }

  async function run() {
    const settings = await getSettings();
    if (!settings.autoReportEnabled) return { exported: false, reason: 'disabled' };
    const [attachmentLogs, auditLogs] = await Promise.all([
      getAttachmentLogs(),
      getMessageAuditLogs()
    ]);
    const model = aggregateStatistics({ attachmentLogs, auditLogs });
    const createdAt = now();
    const messages = await hydrateMessageHeaderIds(
      model.matchedMessages,
      messenger.messages && messenger.messages.get
        ? messageId => messenger.messages.get(messageId)
        : null
    );
    const blob = multiSheetXlsxBlob([
      { name: 'Письма', rows: messageReportRows(messages) }
    ]);
    const url = URL.createObjectURL(blob);
    const filename = scheduledReportFilename(settings.basePath, createdAt);
    try {
      const downloadId = await messenger.downloads.download({
        url,
        filename,
        saveAs: false,
        conflictAction: 'uniquify'
      });
      await messenger.storage.local.set({
        autoReportState: {
          lastExportedAt: createdAt.getTime(),
          lastFilename: filename,
          lastDownloadId: downloadId,
          lastError: ''
        }
      });
      return { exported: true, filename, downloadId };
    } catch (error) {
      await messenger.storage.local.set({
        autoReportState: {
          lastExportedAt: createdAt.getTime(),
          lastFilename: filename,
          lastDownloadId: null,
          lastError: String(error)
        }
      });
      throw error;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function handleAlarm(alarm) {
    if (!alarm || alarm.name !== AUTO_REPORT_ALARM) return { handled: false };
    return { handled: true, ...(await run()) };
  }

  return { schedule, run, handleAlarm };
}
