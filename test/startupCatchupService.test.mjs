import test from 'node:test';
import assert from 'node:assert/strict';

import { createStartupCatchupService } from '../core/startupCatchupService.mjs';

test('после запуска обрабатывает только письма новее контрольной точки', async () => {
  const checkpoint = Date.parse('2026-07-25T10:00:00Z');
  const currentTime = Date.parse('2026-07-25T11:00:00Z');
  const storage = { mailObservationCheckpoint: checkpoint };
  const processed = [];
  const audits = [];
  const inbox = { name: 'Inbox', path: '/Inbox' };
  const messenger = {
    storage: {
      local: {
        async get(defaults) {
          return { ...defaults, ...storage };
        },
        async set(values) {
          Object.assign(storage, values);
        }
      }
    },
    accounts: {
      async list() {
        return [{ id: 'account-1', folders: [inbox] }];
      }
    },
    messages: {
      async list() {
        return {
          messages: [
            { id: 2, date: '2026-07-25T10:30:00Z' },
            { id: 1, date: '2026-07-25T09:30:00Z' }
          ]
        };
      },
      async continueList() {
        throw new Error('pagination is not expected');
      }
    }
  };
  const service = createStartupCatchupService({
    messenger,
    getSettings: async () => ({ liveMode: true, selectedAccounts: [] }),
    getRules: async () => [{ accountIds: ['account-1'] }],
    processMessage: async id => {
      processed.push(id);
      return { processed: 1, saved: 0 };
    },
    logAudit: async row => audits.push(row),
    now: () => currentTime,
    wait: async () => undefined,
    options: { overlapMs: 0 }
  });

  const result = await service.run();

  assert.deepEqual(processed, [2]);
  assert.equal(result.found, 1);
  assert.equal(result.processed, 1);
  assert.equal(storage.mailObservationCheckpoint, currentTime);
  assert.match(audits[0].reason, /найдено 1/);
});

test('стартовая обработка запускается только один раз', async () => {
  const messenger = {
    storage: {
      local: {
        async get(defaults) { return defaults; },
        async set() {}
      }
    },
    accounts: { async list() { return []; } },
    messages: {
      async list() { return { messages: [] }; },
      async continueList() { return null; }
    }
  };
  const service = createStartupCatchupService({
    messenger,
    getSettings: async () => ({ liveMode: true }),
    getRules: async () => [{}],
    processMessage: async () => ({}),
    logAudit: async () => undefined,
    wait: async () => undefined
  });

  assert.equal((await service.run()).started, true);
  assert.deepEqual(await service.run(), { started: false, skipped: true });
});
