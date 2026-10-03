import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRuntimeRouter,
  registerRuntimeRouter
} from '../core/runtimeRouter.mjs';

test('маршрутизирует сообщение по type и передаёт sender', async () => {
  const sender = { id: 'statistics' };
  const router = createRuntimeRouter({
    ping: async (message, actualSender) => ({
      value: message.value,
      sender: actualSender.id
    })
  });

  assert.deepEqual(await router({ type: 'ping', value: 42 }, sender), {
    value: 42,
    sender: 'statistics'
  });
  assert.equal(router({ type: 'unknown' }, sender), undefined);
  assert.equal(router(null, sender), undefined);
});

test('регистрирует один listener вместо нескольких конкурирующих обработчиков', () => {
  const listeners = [];
  const runtime = {
    onMessage: {
      addListener(listener) {
        listeners.push(listener);
      }
    }
  };

  const router = registerRuntimeRouter(runtime, { ping: () => 'pong' });

  assert.equal(listeners.length, 1);
  assert.equal(listeners[0], router);
  assert.equal(router({ type: 'ping' }), 'pong');
});
