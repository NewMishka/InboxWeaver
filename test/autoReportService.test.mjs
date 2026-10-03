import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AUTO_REPORT_ALARM,
  createAutoReportService,
  scheduledReportFilename
} from '../core/autoReportService.mjs';

function fixture(settings = {}) {
  const calls = { clear: [], create: [], downloads: [], storage: [] };
  const messenger = {
    alarms: {
      async clear(name) { calls.clear.push(name); },
      create(name, info) { calls.create.push({ name, info }); }
    },
    downloads: {
      async download(options) { calls.downloads.push(options); return 77; }
    },
    storage: {
      local: { async set(value) { calls.storage.push(value); } }
    }
  };
  const service = createAutoReportService({
    messenger,
    getSettings: async () => ({ basePath: 'Вложения', autoReportEnabled: false, autoReportIntervalMinutes: 1440, ...settings }),
    getAttachmentLogs: async () => [],
    getMessageAuditLogs: async () => [],
    now: () => new Date('2026-08-05T12:30:00.000Z')
  });
  return { service, calls };
}

test('создаёт повторяющееся расписание только когда автоотчёт включён', async () => {
  const enabled = fixture({ autoReportEnabled: true, autoReportIntervalMinutes: 60 });
  assert.deepEqual(await enabled.service.schedule(), { enabled: true, periodInMinutes: 60 });
  assert.equal(enabled.calls.clear[0], AUTO_REPORT_ALARM);
  assert.deepEqual(enabled.calls.create[0], {
    name: AUTO_REPORT_ALARM,
    info: { delayInMinutes: 60, periodInMinutes: 60 }
  });

  const disabled = fixture();
  assert.deepEqual(await disabled.service.schedule(), { enabled: false });
  assert.equal(disabled.calls.create.length, 0);
});

test('выгружает XLSX без диалога в настроенную подпапку', async () => {
  const { service, calls } = fixture({ autoReportEnabled: true, autoReportIntervalMinutes: 30 });
  const result = await service.handleAlarm({ name: AUTO_REPORT_ALARM });

  assert.equal(result.exported, true);
  assert.equal(calls.downloads.length, 1);
  assert.equal(calls.downloads[0].saveAs, false);
  assert.equal(calls.downloads[0].filename, 'Вложения/Отчёты/Автоотчёт_2026-08-05T12-30-00-000Z.xlsx');
  assert.equal(calls.storage[0].autoReportState.lastDownloadId, 77);
});

test('нормализует системный относительный путь отчёта', () => {
  assert.equal(
    scheduledReportFilename('/../Отчёты:*', new Date('2026-08-05T00:00:00.000Z')),
    'Отчёты__/Отчёты/Автоотчёт_2026-08-05T00-00-00-000Z.xlsx'
  );
});
