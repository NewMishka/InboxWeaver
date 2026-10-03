import test from 'node:test';
import assert from 'node:assert/strict';
import { OperationTimeoutError, withTimeout } from '../modules/operationTimeout.mjs';

test('прерывает ожидание неразрешившейся операции понятной ошибкой', async () => {
  await assert.rejects(
    withTimeout(new Promise(() => {}), { operationName: 'messages.get', timeoutMs: 5 }),
    error => error instanceof OperationTimeoutError && error.operation === 'messages.get'
  );
});

test('возвращает результат операции до истечения таймаута', async () => {
  assert.equal(await withTimeout(Promise.resolve('ok'), { timeoutMs: 5 }), 'ok');
});
