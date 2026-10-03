import test from 'node:test';
import assert from 'node:assert/strict';

const values = new Map();
let setCalls = 0;

globalThis.messenger = {
  storage: {
    local: {
      async get(defaultsOrKey) {
        if (defaultsOrKey === null) return Object.fromEntries(values);
        if (typeof defaultsOrKey === 'string') {
          return values.has(defaultsOrKey) ? { [defaultsOrKey]: structuredClone(values.get(defaultsOrKey)) } : {};
        }
        const result = {};
        for (const [key, fallback] of Object.entries(defaultsOrKey || {})) {
          result[key] = structuredClone(values.has(key) ? values.get(key) : fallback);
        }
        return result;
      },
      async set(patch) {
        setCalls += 1;
        for (const [key, value] of Object.entries(patch || {})) values.set(key, structuredClone(value));
      },
      async remove(keys) {
        for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key);
      }
    }
  }
};

const statisticsManager = await import('../modules/statisticsManager.mjs');

test.beforeEach(() => {
  values.clear();
  setCalls = 0;
});

function attachmentRow(overrides = {}) {
  return {
    messageId: '1',
    senderEmail: 'a@example.com',
    subject: 'Отчёт',
    receivedDate: '01.01.2026',
    receivedTime: '10:00:00',
    attachmentName: 'report.pdf',
    partName: '1.2',
    attachmentSize: 100,
    ruleFolder: 'Отчёты',
    ruleName: 'PDF',
    ruleQuery: 'fileext:pdf',
    downloadId: 1,
    status: 'success',
    ...overrides
  };
}

test('прямая запись логов пишет в хранилище на каждый вызов', async () => {
  await statisticsManager.logAttachment(attachmentRow());
  await statisticsManager.logMessageAudit({ messageId: '1', status: 'Обработано' });

  assert.equal(setCalls, 2);
  assert.equal((await statisticsManager.getAttachmentLogs()).length, 1);
  assert.equal((await statisticsManager.getMessageAuditLogs()).length, 1);
});

test('прямая запись дедуплицирует одинаковое вложение', async () => {
  await statisticsManager.logAttachment(attachmentRow());
  await statisticsManager.logAttachment(attachmentRow());

  assert.equal((await statisticsManager.getAttachmentLogs()).length, 1);
});

test('батчер пишет одним запросом вместо одного на письмо', async () => {
  const batcher = statisticsManager.createLogBatcher();
  for (let i = 0; i < 40; i += 1) {
    await batcher.logAttachment(attachmentRow({ messageId: String(i), attachmentSize: i }));
    await batcher.logMessageAudit({ messageId: String(i), status: 'Обработано' });
  }

  assert.equal(setCalls, 0);
  await batcher.flush();

  assert.equal(setCalls, 2);
  assert.equal((await statisticsManager.getAttachmentLogs()).length, 40);
  assert.equal((await statisticsManager.getMessageAuditLogs()).length, 40);
});

test('батчер дедуплицирует вложения внутри пачки и против уже сохранённых', async () => {
  await statisticsManager.logAttachment(attachmentRow({ messageId: '1' }));

  const batcher = statisticsManager.createLogBatcher();
  await batcher.logAttachment(attachmentRow({ messageId: '1' }));
  await batcher.logAttachment(attachmentRow({ messageId: '2' }));
  await batcher.logAttachment(attachmentRow({ messageId: '2' }));
  await batcher.flush();

  const logs = await statisticsManager.getAttachmentLogs();
  assert.deepEqual(logs.map(row => row.messageId).sort(), ['1', '2']);
});

test('пустой flush не обращается к хранилищу', async () => {
  const batcher = statisticsManager.createLogBatcher();
  await batcher.flush();

  assert.equal(setCalls, 0);
});
