import test from 'node:test';
import assert from 'node:assert/strict';

import { deleteDownloadedFiles } from '../core/downloadService.mjs';

function downloadsWith(items) {
  const removed = [];
  const erased = [];
  return {
    removed,
    erased,
    async search() {
      return items;
    },
    async removeFile(id) {
      removed.push(id);
    },
    async erase(query) {
      erased.push(query.id);
    }
  };
}

test('deleteDownloadedFiles resolves a saved file by download id', async () => {
  const downloads = downloadsWith([{ id: 17, filename: '/data/Вложения/report.pdf' }]);

  const result = await deleteDownloadedFiles([{ downloadId: 17 }], downloads);

  assert.deepEqual(downloads.removed, [17]);
  assert.deepEqual(downloads.erased, [17]);
  assert.equal(result.deleted, 1);
  assert.equal(result.failed, 0);
});

test('deleteDownloadedFiles resolves a Windows path by savedAs suffix', async () => {
  const downloads = downloadsWith([
    { id: 21, filename: 'C:\\Downloads\\Вложения\\2026\\invoice.pdf' }
  ]);

  const result = await deleteDownloadedFiles([
    { savedAs: 'Вложения/2026/invoice.pdf', attachmentName: 'invoice.pdf' }
  ], downloads);

  assert.deepEqual(downloads.removed, [21]);
  assert.equal(result.deleted, 1);
  assert.equal(result.failed, 0);
});

test('deleteDownloadedFiles does not guess when an attachment name is ambiguous', async () => {
  const downloads = downloadsWith([
    { id: 31, filename: '/one/report.pdf' },
    { id: 32, filename: '/two/report.pdf' }
  ]);

  const result = await deleteDownloadedFiles([{ attachmentName: 'report.pdf' }], downloads);

  assert.deepEqual(downloads.removed, []);
  assert.equal(result.deleted, 0);
  assert.equal(result.failed, 1);
  assert.match(result.diagnostics[0].error, /not found uniquely/);
});

test('deleteDownloadedFiles reports failure when file still exists after removeFile', async () => {
  const events = [];
  const downloads = {
    async search(query) {
      return query.id
        ? [{ id: 41, filename: '/data/report.pdf', exists: true }]
        : [{ id: 41, filename: '/data/report.pdf', exists: true }];
    },
    async removeFile() {},
    async erase() {}
  };

  const result = await deleteDownloadedFiles(
    [{ downloadId: 41 }],
    downloads,
    {
      operationId: 'reset-1',
      developerLog: async event => events.push(event),
      wait: async () => {}
    }
  );

  assert.equal(result.deleted, 0);
  assert.equal(result.failed, 1);
  assert.equal(result.diagnostics[0].existsAfterRemove, true);
  assert.equal(events.at(-1).stage, 'file-delete');
  assert.equal(events.at(-1).ok, false);
  assert.deepEqual(events.at(-1).details.before, {
    state: '',
    exists: true,
    error: ''
  });
  assert.deepEqual(events.at(-1).details.verificationState, {
    id: 41,
    state: '',
    exists: true,
    error: ''
  });
});

test('deleteDownloadedFiles снимает защиту реестра дублей только для успешно удалённого файла', async () => {
  const forgotten = [];
  const downloads = downloadsWith([
    { id: 61, filename: '/data/a.pdf' },
    { id: 62, filename: '/data/b.pdf' }
  ]);

  const result = await deleteDownloadedFiles(
    [
      { downloadId: 61, contentHash: 'hash-a' },
      { downloadId: 999, contentHash: 'hash-missing' }
    ],
    downloads,
    { forgetExportByHash: async hash => { forgotten.push(hash); return true; } }
  );

  assert.equal(result.deleted, 1);
  assert.equal(result.failed, 1);
  assert.deepEqual(forgotten, ['hash-a']);
  const registryEntry = result.diagnostics.find(row => row.type === 'registry');
  assert.equal(registryEntry.ok, true);
  assert.equal(registryEntry.contentHash, 'hash-a');
});

test('deleteDownloadedFiles не трогает реестр, если удаление не прошло верификацию', async () => {
  const forgotten = [];
  const downloads = {
    async search(query) {
      return query.id
        ? [{ id: 71, filename: '/data/report.pdf', exists: true }]
        : [{ id: 71, filename: '/data/report.pdf', exists: true }];
    },
    async removeFile() {},
    async erase() {}
  };

  const result = await deleteDownloadedFiles(
    [{ downloadId: 71, contentHash: 'hash-stuck' }],
    downloads,
    {
      wait: async () => {},
      forgetExportByHash: async hash => { forgotten.push(hash); return true; }
    }
  );

  assert.equal(result.deleted, 0);
  assert.equal(result.failed, 1);
  assert.deepEqual(forgotten, []);
  assert.equal(result.diagnostics.some(row => row.type === 'registry'), false);
});

test('deleteDownloadedFiles waits for delayed exists=false after removeFile', async () => {
  let checks = 0;
  const waits = [];
  const downloads = {
    async search(query) {
      if (!query.id) return [{ id: 51, filename: '/data/report.pdf', exists: true }];
      checks += 1;
      return [{ id: 51, filename: '/data/report.pdf', exists: checks < 3 }];
    },
    async removeFile() {},
    async erase() {}
  };

  const result = await deleteDownloadedFiles(
    [{ downloadId: 51 }],
    downloads,
    {
      developerLog: async () => {},
      wait: async delay => waits.push(delay)
    }
  );

  assert.equal(result.deleted, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.diagnostics[0].verificationAttempts, 3);
  assert.deepEqual(waits, [100, 250]);
});
