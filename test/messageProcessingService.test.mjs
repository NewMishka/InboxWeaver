import test from 'node:test';
import assert from 'node:assert/strict';

import { createMessageProcessingService } from '../core/messageProcessingService.mjs';

function fixture({
  saved = false,
  saveResult = null,
  query = 'fileext:pdf',
  getError = null,
  listAttachmentsError = null
} = {}) {
  const attachmentLogs = [];
  const auditLogs = [];
  const feedback = [];
  const calls = { getRules: 0, getSettings: 0, listAccounts: 0, getFull: 0, listAttachments: 0 };
  const header = {
    id: 10,
    headerMessageId: '<report-2026-07-25@example.com>',
    subject: 'Ежемесячный отчёт',
    author: 'Иван <ivan@example.com>',
    date: '2026-07-25T10:00:00Z',
    folder: { accountId: 'account-1', path: '/Inbox', name: 'Inbox' }
  };
  const attachment = { name: 'report.pdf', partName: '1.2', size: 100 };
  const service = createMessageProcessingService({
    messenger: {
      messages: {
        async get() {
          if (getError) throw getError;
          return header;
        },
        async listAttachments() {
          calls.listAttachments += 1;
          if (listAttachmentsError) throw listAttachmentsError;
          return [attachment];
        },
        async getFull() {
          calls.getFull += 1;
          return { contentType: 'text/plain', body: 'Документы приложены' };
        },
        async getAttachmentFile() {
          return { name: 'report.pdf', size: 100, async arrayBuffer() { return new ArrayBuffer(1); } };
        }
      },
      downloads: {
        async download() { return 500; },
        async search() { return [{ id: 500, filename: '/tmp/report.pdf' }]; }
      }
    },
    getRules: async () => {
      calls.getRules += 1;
      return [{
        name: 'PDF',
        query,
        folder: 'Отчёты',
        accountIds: ['account-1']
      }];
    },
    getSettings: async () => {
      calls.getSettings += 1;
      return {
        basePath: 'Вложения',
        stopAfterFirstMatch: false
      };
    },
    listAccounts: async () => {
      calls.listAccounts += 1;
      return [{ id: 'account-1', name: 'Рабочий' }];
    },
    logAttachment: async row => attachmentLogs.push(row),
    logMessageAudit: async row => auditLogs.push(row),
    applyResultFeedback: async (...args) => feedback.push(args),
    saveUniqueAttachment: async () => saveResult || (saved
      ? {
          saved: true,
          contentHash: 'abc',
          download: { downloadId: 500, fullPath: '/tmp/report.pdf' }
        }
      : { saved: false })
  });
  return { service, attachmentLogs, auditLogs, feedback, calls };
}

test('проверка письма формирует pending без автоматического сохранения', async () => {
  const { service, attachmentLogs, auditLogs } = fixture();

  const result = await service.processMessage(10);

  assert.equal(result.status, 'pending');
  assert.equal(result.saved, 0);
  assert.equal(attachmentLogs[0].status, 'pending');
  assert.equal(auditLogs[0].status, 'Ожидает сохранения');
});

test('ручное действие сохраняет вложение и возвращает единый результат', async () => {
  const { service, attachmentLogs, auditLogs, feedback } = fixture({ saved: true });

  const result = await service.processMessage(10, { saveAttachments: true });

  assert.equal(result.status, 'processed');
  assert.equal(result.saved, 1);
  assert.equal(attachmentLogs[0].status, 'success');
  assert.equal(attachmentLogs[0].contentHash, 'abc');
  assert.equal(auditLogs[0].status, 'Обработано');
  assert.deepEqual(feedback[0].slice(0, 2), [10, 'Обработано']);
});

test('повторное сохранение того же письма восстанавливает успешную запись из реестра', async () => {
  const { service, attachmentLogs, auditLogs } = fixture({
    saveResult: {
      saved: false,
      contentHash: 'abc',
      duplicateOf: {
        messageId: 10,
        attachmentName: 'report.pdf',
        savedAs: 'Вложения/Отчёты/report.pdf',
        downloadId: 500,
        fullPath: '/tmp/report.pdf'
      }
    }
  });

  const result = await service.processMessage(10, { saveAttachments: true });

  assert.equal(result.status, 'processed');
  assert.equal(result.saved, 0);
  assert.equal(result.alreadySaved, 1);
  assert.equal(result.duplicate, false);
  assert.deepEqual(result.duplicateSources, []);
  assert.equal(attachmentLogs[0].status, 'success');
  assert.equal(attachmentLogs[0].downloadId, 500);
  assert.equal(auditLogs[0].status, 'Обработано');
  assert.match(auditLogs[0].reason, /восстановлены/i);
});

test('контекст правил, настроек и аккаунтов переиспользуется между письмами', async () => {
  const { service, calls } = fixture();

  await service.processMessage(10);
  await service.processMessage(11);

  assert.equal(calls.getRules, 1);
  assert.equal(calls.getSettings, 1);
  assert.equal(calls.listAccounts, 1);
});

test('правило без body не загружает полное MIME-дерево', async () => {
  const { service, calls } = fixture({ query: 'subject:отчёт AND fileext:pdf' });

  await service.processMessage(10);

  assert.equal(calls.getFull, 0);
  assert.equal(calls.listAttachments, 1);
});

test('правило с body загружает полное MIME-дерево', async () => {
  const { service, calls } = fixture({ query: 'body:приложены' });

  await service.processMessage(10);

  assert.equal(calls.getFull, 1);
});

test('ошибка почтового API сохраняет название вызова для диагностики', async () => {
  const error = new Error('An unexpected error occurred');
  const { service } = fixture({ getError: error });

  await assert.rejects(
    service.processMessage(10),
    received => received === error && received.mailOperation === 'messages.get'
  );
});

test('ошибка получения вложений записывается в аудит и не выбрасывается наружу', async () => {
  const error = new Error('An unexpected error occurred');
  const { service, auditLogs, feedback } = fixture({ listAttachmentsError: error });

  const result = await service.processMessage(10);

  assert.equal(result.status, 'error');
  assert.equal(result.checked, true);
  assert.equal(result.mailOperation, 'messages.listAttachments');
  assert.equal(auditLogs[0].status, 'Ошибка');
  assert.match(auditLogs[0].reason, /Не удалось получить список вложений/);
  assert.deepEqual(feedback[0].slice(0, 2), [10, 'Ошибка']);
});

test('журналирует устойчивый заголовок Message-ID вместе с внутренним id письма', async () => {
  const { service, attachmentLogs, auditLogs } = fixture({ saved: true });

  await service.processMessage(10, { saveAttachments: true });

  assert.equal(attachmentLogs[0].messageId, 10);
  assert.equal(attachmentLogs[0].headerMessageId, '<report-2026-07-25@example.com>');
  assert.equal(auditLogs[0].messageId, 10);
  assert.equal(auditLogs[0].headerMessageId, '<report-2026-07-25@example.com>');
});

test('инвалидация контекста повторно загружает настройки и правила', async () => {
  const { service, calls } = fixture();

  await service.processMessage(10);
  service.invalidateRuntimeContext();
  await service.processMessage(11);

  assert.equal(calls.getRules, 2);
  assert.equal(calls.getSettings, 2);
  assert.equal(calls.listAccounts, 2);
});
