import test from 'node:test';
import assert from 'node:assert/strict';

import {
  duplicateSourcesForNotification,
  normalizeProcessingResult,
  PROCESSING_STATUS
} from '../modules/processingResult.mjs';

test('нормализует успешный legacy-результат без потери совместимых полей', () => {
  const result = normalizeProcessingResult({
    checked: true,
    matched: true,
    processed: 2,
    saved: 2,
    auditStatus: 'Обработано',
    reason: 'Есть успешно сохраненные вложения',
    custom: 'preserved'
  });

  assert.equal(result.contractVersion, 1);
  assert.equal(result.status, PROCESSING_STATUS.PROCESSED);
  assert.equal(result.saved, 2);
  assert.equal(result.custom, 'preserved');
});

test('отличает дубль, таймаут и ошибку машинными статусами', () => {
  const duplicate = normalizeProcessingResult({ checked: true, auditStatus: 'Пропущено как дубль' });
  const timeout = normalizeProcessingResult({ checked: true, timeout: true });
  const error = normalizeProcessingResult({ checked: true, error: new Error('broken') });

  assert.equal(duplicate.status, PROCESSING_STATUS.DUPLICATE);
  assert.equal(duplicate.duplicate, true);
  assert.equal(timeout.status, PROCESSING_STATUS.TIMEOUT);
  assert.equal(timeout.timeout, true);
  assert.equal(error.status, PROCESSING_STATUS.ERROR);
  assert.equal(error.error, 'Error: broken');
});

test('распознаёт результат, ожидающий ручного сохранения', () => {
  const result = normalizeProcessingResult({
    checked: true,
    matched: true,
    auditStatus: 'Ожидает сохранения'
  });

  assert.equal(result.status, PROCESSING_STATUS.PENDING);
  assert.equal(result.saved, 0);
});

test('нормализует счётчики и строки', () => {
  const result = normalizeProcessingResult({
    processed: '3',
    saved: -1,
    auditStatus: null,
    reason: null
  });

  assert.equal(result.processed, 3);
  assert.equal(result.saved, 0);
  assert.equal(result.auditStatus, '');
  assert.equal(result.reason, '');
});

test('не показывает внутренний дубль, возникший после сохранения в том же письме', () => {
  const sources = duplicateSourcesForNotification([
    { messageId: 10, attachmentName: 'report.pdf' }
  ], {
    messageId: 10,
    saved: 1
  });

  assert.deepEqual(sources, []);
});

test('сохраняет предупреждение о дубле из другого письма', () => {
  const sources = duplicateSourcesForNotification([
    { messageId: 10, attachmentName: 'new.pdf' },
    { messageId: 20, attachmentName: 'old.pdf' }
  ], {
    messageId: 10,
    saved: 1
  });

  assert.deepEqual(sources, [
    { messageId: 20, attachmentName: 'old.pdf' }
  ]);
});

test('при отсутствии нового сохранения сообщает о дубле этого же письма', () => {
  const sources = duplicateSourcesForNotification([
    { messageId: 10, attachmentName: 'report.pdf' }
  ], {
    messageId: 10,
    saved: 0
  });

  assert.equal(sources.length, 1);
});
