export const MAIL_API_TIMEOUT_MS = 45_000;

export class OperationTimeoutError extends Error {
  constructor(operation, timeoutMs) {
    super(`Превышено время ожидания (${Math.ceil(timeoutMs / 1000)} с): ${operation}`);
    this.name = 'OperationTimeoutError';
    this.code = 'operation-timeout';
    this.operation = String(operation || 'операция');
    this.timeoutMs = Number(timeoutMs);
  }
}

export function isOperationTimeout(error) {
  return error instanceof OperationTimeoutError || error?.code === 'operation-timeout';
}

export async function withTimeout(operation, {
  operationName = 'операция',
  timeoutMs = MAIL_API_TIMEOUT_MS
} = {}) {
  const ms = Math.max(1, Number(timeoutMs) || MAIL_API_TIMEOUT_MS);
  let timeoutId;
  const task = Promise.resolve().then(() =>
    typeof operation === 'function' ? operation() : operation
  );
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new OperationTimeoutError(operationName, ms)), ms);
  });
  try {
    return await Promise.race([task, timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}
