import test from 'node:test';
import assert from 'node:assert/strict';

import {
  groupAttachmentRows,
  normalizePageSize,
  paginate
} from '../modules/pagination.mjs';

test('разбивает список на страницы по 20, 50 или 100 записей', () => {
  const rows = Array.from({ length: 125 }, (_, index) => index + 1);
  const page = paginate(rows, 2, 50);

  assert.deepEqual(page.items, rows.slice(50, 100));
  assert.equal(page.page, 2);
  assert.equal(page.totalPages, 3);
  assert.equal(page.startIndex, 50);
  assert.equal(page.endIndex, 100);
  assert.equal(page.hasPrevious, true);
  assert.equal(page.hasNext, true);
  assert.equal(normalizePageSize(30), 20);
});

test('ограничивает текущую страницу после уменьшения набора данных', () => {
  const page = paginate([1, 2, 3], 9, 20);

  assert.equal(page.page, 1);
  assert.equal(page.totalPages, 1);
  assert.deepEqual(page.items, [1, 2, 3]);
});

test('не разрывает вложения одного письма между группами', () => {
  const groups = groupAttachmentRows([
    { messageId: 10, attachmentName: 'a.pdf' },
    { messageId: 10, attachmentName: 'b.pdf' },
    { messageId: 20, attachmentName: 'c.pdf' },
    { attachmentName: 'legacy.pdf' }
  ]);

  assert.equal(groups.length, 3);
  assert.deepEqual(groups[0].map(item => item.index), [0, 1]);
  assert.equal(groups[2][0].index, 3);
});
