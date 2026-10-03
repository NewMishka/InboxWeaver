import test from 'node:test';
import assert from 'node:assert/strict';

import { createRuleTestService } from '../core/ruleTestService.mjs';

test('тестирование правил использует тот же matcher и область папки', async () => {
  const logs = [];
  const header = {
    id: 10,
    subject: 'Отчёт',
    author: 'sender@example.com',
    date: '2026-07-25T10:00:00Z',
    folder: { accountId: 'account-1', path: '/Inbox', name: 'Inbox' }
  };
  const service = createRuleTestService({
    messenger: {
      accounts: {
        async list() {
          return [{ id: 'account-1', name: 'Рабочий', folders: [header.folder] }];
        }
      },
      messages: {
        async list() { return { messages: [header] }; },
        async continueList() { return null; },
        async listAttachments() { return [{ name: 'report.pdf' }]; }
      }
    },
    getRules: async () => [{
      name: 'PDF',
      query: 'fileext:pdf',
      accountIds: ['account-1']
    }],
    getMessageData: async () => ({
      subject: 'Отчёт',
      sender_email: 'sender@example.com',
      body: '',
      attachments: [{ name: 'report.pdf' }]
    }),
    logRuleTest: async row => logs.push(row)
  });

  const result = await service.testRules({ accountId: 'account-1', count: 5 });

  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].rules[0].matched, true);
  assert.equal(logs[0].messagesChecked, 1);
});
