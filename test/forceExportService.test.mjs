import test from 'node:test';
import assert from 'node:assert/strict';

import { createForceExportService } from '../core/forceExportService.mjs';

function fakeLogBatcher(writeLog) {
  let pending = 0;
  return {
    logAttachment: async () => { pending += 1; },
    logMessageAudit: async () => { pending += 1; },
    flush: async () => {
      if (!pending) return;
      writeLog(pending);
      pending = 0;
    }
  };
}

test('принудительная проверка сканирует выбранные папки и публикует прогресс', async () => {
  const states = [];
  const processedIds = [];
  const notifications = [];
  const inbox = { name: 'Inbox', path: '/Inbox' };
  const messenger = {
    accounts: {
      async list() {
        return [{ id: 'account-1', folders: [inbox] }];
      }
    },
    messages: {
      async list() {
        return { messages: [{ id: 1 }, { id: 2 }] };
      },
      async continueList() {
        return null;
      }
    },
    notifications: {
      create(value) {
        notifications.push(value);
      }
    }
  };
  const service = createForceExportService({
    messenger,
    getRules: async () => [{ accountIds: ['account-1'] }],
    getSettings: async () => ({ selectedAccounts: ['account-1'] }),
    processMessage: async id => {
      processedIds.push(id);
      return { processed: 1, saved: 0 };
    },
    updateState: async state => states.push(state)
  });

  const result = await service.run();

  assert.deepEqual(processedIds, [1, 2]);
  assert.equal(result.checkedMessages, 2);
  assert.equal(result.processed, 2);
  assert.equal(states[0].running, true);
  assert.equal(states.at(-1).done, true);
  assert.match(notifications[0].message, /2/);
});

test('повторный запуск использует single-flight', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const service = createForceExportService({
    messenger: {
      accounts: { async list() { await gate; return []; } },
      messages: {},
      notifications: { create() {} }
    },
    getRules: async () => [{}],
    getSettings: async () => ({ selectedAccounts: [] }),
    processMessage: async () => ({}),
    updateState: async () => undefined
  });

  const first = service.start();
  await Promise.resolve();
  await Promise.resolve();
  const second = service.start();
  release();

  assert.deepEqual(first, { started: true, running: true });
  assert.deepEqual(second, { started: false, running: true });
});

test('остановка завершает текущее письмо и не начинает следующее', async () => {
  let releaseFirst;
  let firstStarted;
  const firstStartedPromise = new Promise(resolve => { firstStarted = resolve; });
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  const processedIds = [];
  const states = [];
  const service = createForceExportService({
    messenger: {
      accounts: {
        async list() {
          return [{ id: 'account-1', folders: [{ name: 'Inbox', path: '/Inbox' }] }];
        }
      },
      messages: {
        async list() { return { messages: [{ id: 1 }, { id: 2 }] }; }
      },
      notifications: { create() {} }
    },
    getRules: async () => [{ accountIds: ['account-1'] }],
    getSettings: async () => ({ selectedAccounts: ['account-1'] }),
    processMessage: async id => {
      processedIds.push(id);
      if (id === 1) {
        firstStarted();
        await firstGate;
      }
      return { processed: 1 };
    },
    updateState: async state => states.push(state)
  });

  assert.deepEqual(service.start(), { started: true, running: true });
  await firstStartedPromise;
  assert.deepEqual(service.stop(), { stopped: true, running: true });
  releaseFirst();
  while (service.running) await new Promise(resolve => setTimeout(resolve, 0));

  assert.deepEqual(processedIds, [1]);
  assert.equal(states.at(-1).stopped, true);
  assert.equal(states.at(-1).checkedMessages, 1);
});

test('ошибка письма записывает messageId и учитывает письмо как проверенное', async () => {
  const events = [];
  const service = createForceExportService({
    messenger: {
      accounts: {
        async list() {
          return [{ id: 'account-1', folders: [{ name: 'Inbox', path: '/Inbox' }] }];
        }
      },
      messages: {
        async list() {
          return { messages: [{ id: 77 }] };
        }
      },
      notifications: { create() {} }
    },
    getRules: async () => [{ accountIds: ['account-1'] }],
    getSettings: async () => ({ selectedAccounts: ['account-1'] }),
    processMessage: async () => {
      const error = new Error('unexpected');
      error.mailOperation = 'messages.get';
      throw error;
    },
    updateState: async () => undefined,
    developerLog: async event => events.push(event)
  });

  const result = await service.run();
  const failure = events.find(event => event.stage === 'message-failed');

  assert.equal(result.checkedMessages, 1);
  assert.equal(result.failedMessages, 1);
  assert.equal(failure.details.messageId, 77);
  assert.equal(failure.details.mailOperation, 'messages.get');
  assert.match(failure.details.error, /unexpected/);
  assert.equal(events.at(-1).stage, 'completed');
  assert.equal(events.at(-1).ok, false);
});

test('тайм-аут обработки одного письма не останавливает обход следующих', async () => {
  const processedIds = [];
  const events = [];
  const service = createForceExportService({
    messenger: {
      accounts: {
        async list() {
          return [{ id: 'account-1', folders: [{ name: 'Inbox', path: '/Inbox' }] }];
        }
      },
      messages: {
        async list() { return { messages: [{ id: 675 }, { id: 676 }] }; }
      },
      notifications: { create() {} }
    },
    getRules: async () => [{ accountIds: ['account-1'] }],
    getSettings: async () => ({ selectedAccounts: ['account-1'] }),
    processMessage: async id => {
      processedIds.push(id);
      if (id === 675) return await new Promise(() => {});
      return { processed: 1 };
    },
    updateState: async () => undefined,
    developerLog: async event => events.push(event),
    mailApiTimeoutMs: 5
  });

  const result = await service.run();
  const failure = events.find(event => event.stage === 'message-failed');

  assert.deepEqual(processedIds, [675, 676]);
  assert.equal(result.checkedMessages, 2);
  assert.equal(result.failedMessages, 1);
  assert.equal(result.processed, 1);
  assert.equal(failure.details.messageId, 675);
  assert.equal(failure.details.timedOut, true);
});

test('результат с ошибкой письма учитывается без остановки обхода', async () => {
  const events = [];
  const service = createForceExportService({
    messenger: {
      accounts: {
        async list() {
          return [{ id: 'account-1', folders: [{ name: 'Inbox', path: '/Inbox' }] }];
        }
      },
      messages: {
        async list() { return { messages: [{ id: 50 }, { id: 51 }] }; }
      },
      notifications: { create() {} }
    },
    getRules: async () => [{ accountIds: ['account-1'] }],
    getSettings: async () => ({ selectedAccounts: ['account-1'] }),
    processMessage: async id => id === 50
      ? {
          status: 'error',
          checked: true,
          error: 'An unexpected error occurred',
          mailOperation: 'messages.listAttachments'
        }
      : { status: 'checked', checked: true, processed: 1 },
    updateState: async () => undefined,
    developerLog: async event => events.push(event)
  });

  const result = await service.run();
  const failure = events.find(event => event.stage === 'message-processing-error');

  assert.equal(result.checkedMessages, 2);
  assert.equal(result.failedMessages, 1);
  assert.equal(result.processed, 1);
  assert.equal(failure.details.messageId, 50);
  assert.equal(failure.details.mailOperation, 'messages.listAttachments');
});

test('прогресс большого обхода записывается пакетами', async () => {
  const states = [];
  const messages = Array.from({ length: 60 }, (_, index) => ({ id: index + 1 }));
  const service = createForceExportService({
    messenger: {
      accounts: {
        async list() {
          return [{ id: 'account-1', folders: [{ name: 'Inbox', path: '/Inbox' }] }];
        }
      },
      messages: {
        async list() { return { messages }; }
      },
      notifications: { create() {} }
    },
    getRules: async () => [{ accountIds: ['account-1'] }],
    getSettings: async () => ({ selectedAccounts: ['account-1'] }),
    processMessage: async () => ({ processed: 1 }),
    updateState: async state => states.push(state)
  });

  const result = await service.run();
  const progressStates = states.filter(state => state.checkedMessages !== undefined);

  assert.equal(result.checkedMessages, 60);
  assert.ok(progressStates.length < 10);
  assert.ok(progressStates.some(state => state.checkedMessages === 25));
  assert.ok(progressStates.some(state => state.checkedMessages === 50));
});

test('журналы обхода пишутся пакетами вместе с прогрессом, а не на каждое письмо', async () => {
  const flushSizes = [];
  const messages = Array.from({ length: 60 }, (_, index) => ({ id: index + 1 }));
  const service = createForceExportService({
    messenger: {
      accounts: {
        async list() {
          return [{ id: 'account-1', folders: [{ name: 'Inbox', path: '/Inbox' }] }];
        }
      },
      messages: {
        async list() { return { messages }; }
      },
      notifications: { create() {} }
    },
    getRules: async () => [{ accountIds: ['account-1'] }],
    getSettings: async () => ({ selectedAccounts: ['account-1'] }),
    processMessage: async (id, { logSink } = {}) => {
      await logSink.logAttachment({ messageId: id });
      await logSink.logMessageAudit({ messageId: id });
      return { processed: 1 };
    },
    updateState: async () => undefined,
    createLogBatcher: () => fakeLogBatcher(size => flushSizes.push(size))
  });

  const result = await service.run();

  assert.equal(result.checkedMessages, 60);
  assert.ok(flushSizes.length < 10, 'должно быть меньше записей в хранилище, чем писем');
  assert.equal(flushSizes.reduce((sum, size) => sum + size, 0), 120);
});
