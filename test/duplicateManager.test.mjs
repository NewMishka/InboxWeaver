import test from 'node:test';
import assert from 'node:assert/strict';

const values = new Map();
globalThis.messenger = {
  storage: {
    local: {
      async get(defaults) {
        const result = {};
        for (const [key, fallback] of Object.entries(defaults || {})) {
          result[key] = structuredClone(values.has(key) ? values.get(key) : fallback);
        }
        return result;
      },
      async set(patch) {
        await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 3)));
        for (const [key, value] of Object.entries(patch || {})) values.set(key, structuredClone(value));
      },
      async remove() {}
    }
  }
};

const duplicate = await import('../modules/duplicateManager.mjs');
const { deleteDownloadedFiles } = await import('../core/downloadService.mjs');

test.beforeEach(() => values.clear());

function attachment(text) {
  return {
    async arrayBuffer() {
      return new TextEncoder().encode(text).buffer;
    }
  };
}

test('SHA-256 зависит от содержимого, а не от письма или имени', async () => {
  const first = await duplicate.hashAttachment(attachment('same bytes'));
  const second = await duplicate.hashAttachment(attachment('same bytes'));
  const other = await duplicate.hashAttachment(attachment('other bytes'));

  assert.equal(first.contentHash, second.contentHash);
  assert.notEqual(first.contentHash, other.contentHash);
});

test('атомарно разрешает только одну резервацию одинакового содержимого', async () => {
  const contentHash = (await duplicate.hashAttachment(attachment('same bytes'))).contentHash;
  const claims = await Promise.all(
    Array.from({ length: 20 }, (_, messageId) =>
      duplicate.reserveExport({ contentHash, fingerprint: `legacy-${messageId}`, entry: { messageId } })
    )
  );

  assert.equal(claims.filter(item => item.claimed).length, 1);
  assert.equal(values.get('exportRegistry').length, 1);
});

test('разное содержимое сохраняется при одинаковом fingerprint', async () => {
  const fingerprint = 'same-message-and-attachment-metadata';
  const first = await duplicate.reserveExport({ contentHash: 'first-hash', fingerprint });
  const second = await duplicate.reserveExport({ contentHash: 'second-hash', fingerprint });

  assert.equal(first.claimed, true);
  assert.equal(second.claimed, true);
  assert.equal(values.get('exportRegistry').length, 2);
});

test('одинаковый SHA блокируется между письмами и именами с суффиксом', async () => {
  const first = await duplicate.reserveExport({
    contentHash: 'global-same-hash',
    fingerprint: 'later-message',
    entry: { messageId: 200, attachmentName: 'report.pdf' }
  });
  await duplicate.commitExport(first.reservationId, { downloadId: 900 });

  const earlierMessage = await duplicate.reserveExport({
    contentHash: 'global-same-hash',
    fingerprint: 'earlier-message',
    entry: { messageId: 100, attachmentName: 'report(1).pdf' }
  });

  assert.equal(earlierMessage.claimed, false);
  assert.equal(earlierMessage.duplicateOf.messageId, 200);
  assert.equal(earlierMessage.duplicateOf.attachmentName, 'report.pdf');
  assert.equal(values.get('exportRegistry').length, 1);
});

test('источником дубля выбирает последнее подтверждённое сохранение, а не первое письмо', async () => {
  const selected = duplicate.selectDuplicateSource([
    {
      messageId: 100,
      subject: 'Первое поступление',
      contentHash: 'same',
      ts: 100
    },
    {
      messageId: 200,
      subject: 'Фактическое сохранение',
      contentHash: 'same',
      downloadId: 77,
      reserved: false,
      ts: 200
    },
    {
      messageId: 300,
      subject: 'Незавершённая попытка',
      contentHash: 'same',
      reserved: true,
      ts: 300
    }
  ]);

  assert.equal(selected.messageId, 200);
  assert.equal(selected.subject, 'Фактическое сохранение');
});

test('fingerprint предотвращает дубль только для исторической записи без SHA-256', async () => {
  await duplicate.recordExport({ fingerprint: 'legacy-fingerprint' });

  const duplicateClaim = await duplicate.reserveExport({
    contentHash: 'new-hash',
    fingerprint: 'legacy-fingerprint'
  });
  const distinctClaim = await duplicate.reserveExport({
    contentHash: 'another-hash',
    fingerprint: 'another-fingerprint'
  });

  assert.equal(duplicateClaim.claimed, false);
  assert.equal(distinctClaim.claimed, true);
});

test('commit превращает резервацию в постоянную запись', async () => {
  const claim = await duplicate.reserveExport({
    contentHash: 'abc',
    entry: {
      messageId: 1,
      subject: 'Первичное письмо',
      receivedDate: '25.07.2026',
      senderEmail: 'sender@example.com',
      attachmentName: 'report.pdf'
    }
  });
  assert.equal(await duplicate.commitExport(claim.reservationId, { savedAs: 'file.pdf' }), true);

  const [row] = values.get('exportRegistry');
  assert.equal(row.reserved, false);
  assert.equal(row.savedAs, 'file.pdf');
  const repeated = await duplicate.reserveExport({ contentHash: 'abc' });
  assert.equal(repeated.claimed, false);
  assert.deepEqual(repeated.duplicateOf, {
    messageId: 1,
    subject: 'Первичное письмо',
    receivedDate: '25.07.2026',
    senderEmail: 'sender@example.com',
    attachmentName: 'report.pdf',
    savedAs: 'file.pdf',
    downloadId: null,
    fullPath: ''
  });
});

test('удаляет устаревшую SHA-запись и разрешает повторную резервацию', async () => {
  const claim = await duplicate.reserveExport({ contentHash: 'stale-hash' });
  await duplicate.commitExport(claim.reservationId, { downloadId: 55 });

  assert.equal(await duplicate.forgetExportByHash('stale-hash'), true);
  assert.equal((await duplicate.reserveExport({ contentHash: 'stale-hash' })).claimed, true);
});

test('release позволяет повторить операцию после ошибки сохранения', async () => {
  const claim = await duplicate.reserveExport({ contentHash: 'abc' });
  assert.equal(await duplicate.releaseExport(claim.reservationId), true);
  assert.equal((await duplicate.reserveExport({ contentHash: 'abc' })).claimed, true);
});

test('reconcileExportRegistry освобождает записи, чьих файлов больше нет в истории загрузок', async () => {
  const goneClaim = await duplicate.reserveExport({ contentHash: 'gone-hash' });
  await duplicate.commitExport(goneClaim.reservationId, { downloadId: 101 });
  const keptClaim = await duplicate.reserveExport({ contentHash: 'kept-hash' });
  await duplicate.commitExport(keptClaim.reservationId, { downloadId: 102 });

  const result = await duplicate.reconcileExportRegistry(async ({ id }) => {
    if (id === 101) return [{ id: 101, exists: false }];
    if (id === 102) return [{ id: 102, exists: true }];
    return [];
  });

  assert.equal(result.checked, 2);
  assert.equal(result.released, 1);
  assert.equal((await duplicate.reserveExport({ contentHash: 'gone-hash' })).claimed, true);
  assert.equal((await duplicate.reserveExport({ contentHash: 'kept-hash' })).claimed, false);
});

test('reconcileExportRegistry освобождает запись, если загрузка вообще не найдена в истории', async () => {
  const claim = await duplicate.reserveExport({ contentHash: 'missing-history-hash' });
  await duplicate.commitExport(claim.reservationId, { downloadId: 201 });

  const result = await duplicate.reconcileExportRegistry(async () => []);

  assert.equal(result.released, 1);
  assert.equal((await duplicate.reserveExport({ contentHash: 'missing-history-hash' })).claimed, true);
});

test('reconcileExportRegistry не трогает незавершённые резервации и записи без downloadId', async () => {
  await duplicate.reserveExport({ contentHash: 'still-reserved' });
  const noDownloadClaim = await duplicate.reserveExport({ contentHash: 'no-download-id' });
  await duplicate.commitExport(noDownloadClaim.reservationId, {});

  const searched = [];
  const result = await duplicate.reconcileExportRegistry(async query => {
    searched.push(query.id);
    return [];
  });

  assert.equal(result.checked, 0);
  assert.deepEqual(searched, []);
  assert.equal((await duplicate.reserveExport({ contentHash: 'still-reserved' })).claimed, false);
  assert.equal((await duplicate.reserveExport({ contentHash: 'no-download-id' })).claimed, false);
});

test('reconcileExportRegistry оставляет запись при ошибке поиска (fail safe)', async () => {
  const claim = await duplicate.reserveExport({ contentHash: 'search-error-hash' });
  await duplicate.commitExport(claim.reservationId, { downloadId: 301 });

  const result = await duplicate.reconcileExportRegistry(async () => {
    throw new Error('search unavailable');
  });

  assert.equal(result.released, 0);
  assert.equal((await duplicate.reserveExport({ contentHash: 'search-error-hash' })).claimed, false);
});

test('удаление файла через deleteDownloadedFiles снимает защиту и разрешает пересохранение', async () => {
  const claim = await duplicate.reserveExport({ contentHash: 'deleted-file-hash' });
  await duplicate.commitExport(claim.reservationId, { downloadId: 91, fullPath: '/data/report.pdf' });

  const blocked = await duplicate.reserveExport({ contentHash: 'deleted-file-hash' });
  assert.equal(blocked.claimed, false, 'до удаления файл должен считаться дублем');

  const downloads = {
    async search() { return [{ id: 91, filename: '/data/report.pdf' }]; },
    async removeFile() {},
    async erase() {}
  };
  const result = await deleteDownloadedFiles(
    [{ downloadId: 91, contentHash: 'deleted-file-hash' }],
    downloads
  );
  assert.equal(result.deleted, 1);

  const allowed = await duplicate.reserveExport({ contentHash: 'deleted-file-hash' });
  assert.equal(allowed.claimed, true, 'после удаления файла реестр не должен блокировать пересохранение');
});

test('режим с разрешёнными дублями сохраняет историю без резервации', async () => {
  await duplicate.recordExport({ messageId: 1, fingerprint: 'one' });
  await duplicate.recordExport({ messageId: 2, fingerprint: 'two' });

  assert.equal(values.get('exportRegistry').length, 2);
  assert.equal(values.get('exportRegistry').every(row => row.reserved === false), true);
});
