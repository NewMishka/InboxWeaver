import test from 'node:test';
import assert from 'node:assert/strict';

import { createSingleFlight } from '../modules/singleFlight.mjs';

test('объединяет параллельную обработку одного ключа', async () => {
  const singleFlight = createSingleFlight();
  let calls = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const operation = async () => {
    calls++;
    await gate;
    return { saved: 1 };
  };

  const first = singleFlight.run(42, operation);
  const second = singleFlight.run('42', operation);
  assert.equal(first, second);
  assert.equal(calls, 0);
  assert.equal(singleFlight.has(42), true);

  release();
  assert.deepEqual(await Promise.all([first, second]), [{ saved: 1 }, { saved: 1 }]);
  assert.equal(calls, 1);
  assert.equal(singleFlight.size, 0);
});

test('разные ключи не блокируют друг друга', async () => {
  const singleFlight = createSingleFlight();
  const order = [];

  await Promise.all([
    singleFlight.run('a', async () => { order.push('a'); }),
    singleFlight.run('b', async () => { order.push('b'); })
  ]);

  assert.deepEqual(new Set(order), new Set(['a', 'b']));
});

test('после ошибки разрешает повторный запуск', async () => {
  const singleFlight = createSingleFlight();
  await assert.rejects(singleFlight.run('a', () => {
    throw new Error('expected');
  }), /expected/);

  assert.equal(await singleFlight.run('a', () => 'ok'), 'ok');
});
