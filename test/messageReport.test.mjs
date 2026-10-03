import test from 'node:test';
import assert from 'node:assert/strict';

import { hydrateMessageHeaderIds, messageReportRows } from '../modules/messageReport.mjs';
import { OUTCOME } from '../modules/statisticsAggregator.mjs';

test('формирует единственный набор колонок отчёта по письмам', () => {
  const [row] = messageReportRows([{
    messageId: 42,
    headerMessageId: '<abc123@mail.example.test>',
    receivedDate: '13.08.2026',
    receivedTime: '09:30',
    importance: 'high',
    accountName: 'Входящие',
    senderName: 'Иван Иванов',
    senderEmail: 'ivan@example.test',
    subject: 'Документы',
    outcome: OUTCOME.PROCESSED,
    matchedAttachments: [{ name: 'акт.pdf' }]
  }]);

  assert.deepEqual(Object.keys(row), [
    'message_id',
    'duplicate_message_id',
    'received_date',
    'received_time',
    'importance',
    'mailbox',
    'sender_name',
    'sender_email',
    'subject',
    'matched_attachments',
    'availability_of_attachments',
    'accepted_for_work',
    'closure_details'
  ]);
  assert.equal(row.message_id, '<abc123@mail.example.test>');
  assert.equal(row.duplicate_message_id, 'no');
  assert.equal(row.availability_of_attachments, 'yes');
  assert.equal(row.accepted_for_work, '');
  assert.equal(row.closure_details, '');
});

test('использует заголовок Message-ID письма, а не внутренний нестабильный id', () => {
  const [row] = messageReportRows([{
    messageId: 1,
    headerMessageId: '',
    outcome: OUTCOME.PROCESSED
  }]);

  assert.equal(row.message_id, '');
});

test('восстанавливает Message-ID старой записи по временному id, не экспортируя его', async () => {
  const [message] = await hydrateMessageHeaderIds([{
    messageId: 42,
    headerMessageId: '',
    outcome: OUTCOME.PROCESSED
  }], async messageId => {
    assert.equal(messageId, 42);
    return { id: 42, headerMessageId: '<sent-message@example.test>' };
  });

  assert.equal(message.headerMessageId, '<sent-message@example.test>');
  assert.equal(messageReportRows([message])[0].message_id, '<sent-message@example.test>');
});

test('не подменяет Message-ID внутренним id, если письмо уже недоступно', async () => {
  const [message] = await hydrateMessageHeaderIds([{
    messageId: 42,
    headerMessageId: '',
    outcome: OUTCOME.PROCESSED
  }], async () => { throw new Error('not found'); });

  assert.equal(messageReportRows([message])[0].message_id, '');
});

test('ограничивает параллельное восстановление заголовков и гасит синхронную ошибку', async () => {
  let active = 0;
  let maxActive = 0;
  const messages = Array.from({ length: 20 }, (_, messageId) => ({ messageId }));
  messages.push({ messageId: 999 });

  const hydrated = await hydrateMessageHeaderIds(messages, messageId => {
    if (messageId === 999) throw new Error('adapter error');
    active += 1;
    maxActive = Math.max(maxActive, active);
    return new Promise(resolve => setTimeout(() => {
      active -= 1;
      resolve({ headerMessageId: `<${messageId}@example.test>` });
    }, 0));
  });

  assert.ok(maxActive <= 8);
  assert.equal(hydrated[0].headerMessageId, '<0@example.test>');
  assert.equal(hydrated.at(-1).headerMessageId, undefined);
});

test('указывает отсутствие вложений', () => {
  const [row] = messageReportRows([{
    outcome: OUTCOME.NO_ATTACHMENTS,
    matchedAttachments: []
  }]);

  assert.equal(row.availability_of_attachments, 'no');
});

test('помечает повторяющийся message_id, но не схлопывает строки', () => {
  const rows = messageReportRows([
    { headerMessageId: '<same@example.test>', receivedDate: '10.08.2026', receivedTime: '09:00', outcome: OUTCOME.PROCESSED },
    { headerMessageId: '<same@example.test>', receivedDate: '11.08.2026', receivedTime: '09:00', outcome: OUTCOME.PROCESSED },
    { headerMessageId: '<unique@example.test>', receivedDate: '12.08.2026', receivedTime: '09:00', outcome: OUTCOME.PROCESSED }
  ]);

  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(row => row.duplicate_message_id), ['no', 'yes', 'yes']);
});

test('не помечает как дубль несколько писем без Message-ID', () => {
  const rows = messageReportRows([
    { headerMessageId: '', outcome: OUTCOME.PROCESSED },
    { headerMessageId: '', outcome: OUTCOME.PROCESSED }
  ]);

  assert.deepEqual(rows.map(row => row.duplicate_message_id), ['no', 'no']);
});

test('сортирует строки отчёта по дате получения от новых к старым', () => {
  const rows = messageReportRows([
    { headerMessageId: 'old', receivedDate: '01.01.2026', receivedTime: '10:00', outcome: OUTCOME.PROCESSED },
    { headerMessageId: 'newest', receivedDate: '20.08.2026', receivedTime: '08:00', outcome: OUTCOME.PROCESSED },
    { headerMessageId: 'same-day-later', receivedDate: '01.01.2026', receivedTime: '18:30', outcome: OUTCOME.PROCESSED }
  ]);

  assert.deepEqual(rows.map(row => row.message_id), ['newest', 'same-day-later', 'old']);
});
