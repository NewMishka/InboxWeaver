import test from 'node:test';
import assert from 'node:assert/strict';

import { createRetryService } from '../core/retryService.mjs';

test('повторяет только последние ошибочные состояния писем', async () => {
  const processed = [];
  const retryLogs = [];
  const latest = new Map();
  const service = createRetryService({
    processMessage: async id => {
      processed.push(id);
      latest.set(String(id), { status: 'Обработано' });
      return { processed: 1 };
    },
    latestAudit: async id => latest.get(String(id)) || null,
    logRetry: async row => retryLogs.push(row),
    getAuditLogs: async () => [
      { messageId: 1, timestamp: 1, status: 'Ошибка' },
      { messageId: 1, timestamp: 2, status: 'Обработано' },
      { messageId: 2, timestamp: 3, status: 'Ошибка' }
    ]
  });

  const result = await service.retryFailedMessages();

  assert.deepEqual(processed, [2]);
  assert.equal(result.retried, 1);
  assert.equal(result.added, 1);
  assert.equal(retryLogs.length, 1);
});
