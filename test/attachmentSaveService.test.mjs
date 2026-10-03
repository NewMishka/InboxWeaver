import test from 'node:test';
import assert from 'node:assert/strict';

import { saveUniqueAttachment } from '../modules/attachmentSaveService.mjs';

function file(bytes, name) {
  return {
    name,
    async arrayBuffer() {
      return bytes;
    }
  };
}

function duplicateManager() {
  const hashes = new Map();
  return {
    hashes,
    async hashAttachment(attachment) {
      const buffer = await attachment.arrayBuffer();
      const contentHash = [...new Uint8Array(buffer)].join('-');
      return { buffer, contentHash };
    },
    async reserveExport({ contentHash, entry }) {
      if (hashes.has(contentHash)) {
        return { claimed: false, duplicateOf: hashes.get(contentHash) };
      }
      hashes.set(contentHash, { ...entry, reserved: true });
      return { claimed: true, reservationId: contentHash };
    },
    async commitExport(reservationId, entry) {
      hashes.set(reservationId, { ...entry, reserved: false });
      return true;
    },
    async releaseExport(reservationId) {
      hashes.delete(reservationId);
      return true;
    }
  };
}

test('хеширует и сохраняет один и тот же буфер', async () => {
  const bytes = new Uint8Array([1, 2, 3]).buffer;
  const manager = duplicateManager();
  let savedBuffer = null;

  const result = await saveUniqueAttachment({
    file: file(bytes, 'report.pdf'),
    entry: { messageId: 1 },
    duplicateManager: manager,
    async saveBuffer(buffer) {
      savedBuffer = buffer;
      return { downloadId: 10 };
    }
  });

  assert.equal(result.saved, true);
  assert.equal(savedBuffer, bytes);
});

test('блокирует те же байты в другом письме и под именем с суффиксом', async () => {
  const bytes = new Uint8Array([7, 8, 9]).buffer;
  const manager = duplicateManager();
  let saves = 0;
  const saveBuffer = async () => ({ downloadId: ++saves });

  const later = await saveUniqueAttachment({
    file: file(bytes, 'report.pdf'),
    entry: { messageId: 200, attachmentName: 'report.pdf' },
    duplicateManager: manager,
    saveBuffer
  });
  const earlier = await saveUniqueAttachment({
    file: file(bytes, 'report(1).pdf'),
    entry: { messageId: 100, attachmentName: 'report(1).pdf' },
    duplicateManager: manager,
    saveBuffer
  });

  assert.equal(later.saved, true);
  assert.equal(earlier.saved, false);
  assert.equal(earlier.status, 'duplicate');
  assert.equal(saves, 1);
});
