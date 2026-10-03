import test from 'node:test';
import assert from 'node:assert/strict';

import {
  queryDownloadItemsForLogs,
  reconcileAttachmentAvailability
} from '../modules/attachmentAvailability.mjs';

test('помечает удалённый файл по состоянию downloads API', () => {
  const [row] = reconcileAttachmentAvailability(
    [{ downloadId: 10, status: 'success' }],
    [{ id: 10, exists: false }]
  );

  assert.equal(row.fileExists, false);
});

test('не объявляет файл удалённым, если downloads API не знает его состояние', () => {
  const [row] = reconcileAttachmentAvailability(
    [{ downloadId: 11, status: 'success' }],
    []
  );

  assert.equal(row.fileExists, null);
});

test('адресно проверяет каждый уникальный downloadId и получает актуальный exists', async () => {
  const queries = [];
  const items = await queryDownloadItemsForLogs([
    { downloadId: 10, status: 'success' },
    { downloadId: 10, status: 'success' },
    { downloadId: 11, status: 'success' },
    { downloadId: 12, status: 'pending' }
  ], async query => {
    queries.push(query);
    return [{ id: query.id, exists: query.id !== 10 }];
  });

  assert.deepEqual(queries, [{ id: 10 }, { id: 11 }]);
  assert.deepEqual(items, [
    { id: 10, exists: false },
    { id: 11, exists: true }
  ]);
});
