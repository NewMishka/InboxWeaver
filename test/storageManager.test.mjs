import test from 'node:test';
import assert from 'node:assert/strict';

const values = new Map();
const delay = () => new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 4)));

globalThis.messenger = {
  storage: {
    local: {
      async get(defaultsOrKey) {
        await delay();
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
        await delay();
        for (const [key, value] of Object.entries(patch || {})) values.set(key, structuredClone(value));
      },
      async remove(keys) {
        for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key);
      }
    }
  }
};

const storage = await import('../modules/storageManager.mjs');

test.beforeEach(() => values.clear());

test('не теряет параллельные добавления в один массив', async () => {
  await Promise.all(
    Array.from({ length: 100 }, (_, index) => storage.appendToArray('events', { index }, 0))
  );

  const events = await storage.getArray('events');
  assert.equal(events.length, 100);
  assert.deepEqual(events.map(item => item.index).sort((a, b) => a - b), Array.from({ length: 100 }, (_, i) => i));
});

test('пакетное добавление пишет один раз и уважает лимит', async () => {
  await storage.appendToArray('batchEvents', { index: -1 }, 0);
  await storage.appendManyToArray('batchEvents', [{ index: 0 }, { index: 1 }, { index: 2 }], 3);

  const events = await storage.getArray('batchEvents');
  assert.deepEqual(events.map(item => item.index), [0, 1, 2]);
});

test('пакетное добавление пустого списка не трогает хранилище', async () => {
  await storage.setArray('untouched', [{ index: 0 }]);
  await storage.appendManyToArray('untouched', [], 10);

  assert.deepEqual(await storage.getArray('untouched'), [{ index: 0 }]);
});

test('сохраняет порядок обновлений одного ключа', async () => {
  const first = storage.update('counter', async value => {
    await delay();
    return Number(value) + 1;
  }, 0);
  const second = storage.update('counter', value => Number(value) + 1, 0);

  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  assert.equal(await storage.get('counter', 0), 2);
});

test('ошибка обновления не блокирует очередь ключа', async () => {
  await assert.rejects(storage.update('counter', () => {
    throw new Error('expected');
  }, 0), /expected/);

  assert.equal(await storage.update('counter', value => Number(value) + 1, 0), 1);
});

test('параллельные патчи export state не перезаписывают друг друга', async () => {
  await Promise.all([
    storage.setExportState({ running: true, processed: 7 }),
    storage.setExportState({ saved: 3, done: true })
  ]);

  assert.deepEqual(await storage.getExportState(), {
    running: true,
    processed: 7,
    saved: 3,
    done: true,
    error: '',
    startedAt: 0,
    finishedAt: 0
  });
});
