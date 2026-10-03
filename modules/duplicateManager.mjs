import { update as storageUpdate, getArray as storageGetArray } from './storageManager.mjs';

const REGISTRY_KEY = 'exportRegistry';
const REGISTRY_LIMIT = 20000;
const RESERVATION_TTL_MS = 10 * 60 * 1000;

function createReservationId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function isExpiredReservation(row, now) {
  return !!(row && row.reserved === true && Number(row.expiresAt || 0) <= now);
}

function savedTimestamp(row) {
  return Number(row && (row.ts || row.timestamp) || 0);
}

function isCommittedSave(row) {
  return !!(
    row &&
    row.reserved !== true &&
    (row.downloadId !== null && row.downloadId !== undefined || String(row.fullPath || '').trim())
  );
}

export function selectDuplicateSource(rows = []) {
  return [...(Array.isArray(rows) ? rows : [])].sort((left, right) =>
    Number(isCommittedSave(right)) - Number(isCommittedSave(left)) ||
    savedTimestamp(right) - savedTimestamp(left)
  )[0] || null;
}

export async function hashAttachment(file) {
  if (!file || typeof file.arrayBuffer !== 'function') {
    throw new TypeError('Attachment does not provide arrayBuffer()');
  }
  if (!globalThis.crypto || !globalThis.crypto.subtle) {
    throw new Error('SHA-256 is not supported in this runtime');
  }
  const buffer = await file.arrayBuffer();
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  const contentHash = [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
  return { buffer, contentHash };
}

export async function reserveExport({ contentHash, fingerprint = '', entry = {} }) {
  const normalizedHash = String(contentHash || '').trim().toLowerCase();
  if (!normalizedHash) throw new TypeError('contentHash is required');

  const reservationId = createReservationId();
  const now = Date.now();
  let claimed = false;
  let duplicateOf = null;
  await storageUpdate(REGISTRY_KEY, current => {
    let rows = (Array.isArray(current) ? current : [])
      .filter(row => !isExpiredReservation(row, now));
    const matchingRows = rows.filter(row => {
      const storedHash = String(row.contentHash || '').trim().toLowerCase();
      if (storedHash) return storedHash === normalizedHash;
      return !!(fingerprint && String(row.fingerprint || '') === String(fingerprint));
    });
    duplicateOf = selectDuplicateSource(matchingRows);
    const exactHashMatches = matchingRows.filter(
      row => String(row.contentHash || '').trim().toLowerCase() === normalizedHash
    );
    if (duplicateOf && exactHashMatches.length > 1) {
      rows = rows.filter(row =>
        String(row.contentHash || '').trim().toLowerCase() !== normalizedHash ||
        row === duplicateOf
      );
    }
    if (duplicateOf) return rows;

    claimed = true;
    rows.push({
      ...entry,
      contentHash: normalizedHash,
      fingerprint,
      reservationId,
      reserved: true,
      ts: now,
      expiresAt: now + RESERVATION_TTL_MS
    });
    return rows.slice(-REGISTRY_LIMIT);
  }, []);

  return claimed
    ? { claimed: true, reservationId, contentHash: normalizedHash, duplicateOf: null }
    : {
        claimed: false,
        reservationId: '',
        contentHash: normalizedHash,
        duplicateOf: duplicateOf ? {
          messageId: duplicateOf.messageId || '',
          subject: duplicateOf.subject || '',
          receivedDate: duplicateOf.receivedDate || '',
          senderEmail: duplicateOf.senderEmail || '',
          attachmentName: duplicateOf.attachmentName || '',
          savedAs: duplicateOf.savedAs || '',
          downloadId: duplicateOf.downloadId ?? null,
          fullPath: duplicateOf.fullPath || ''
        } : null
      };
}

export async function forgetExportByHash(contentHash) {
  const normalizedHash = String(contentHash || '').trim().toLowerCase();
  if (!normalizedHash) return false;
  let removed = false;
  await storageUpdate(REGISTRY_KEY, current =>
    (Array.isArray(current) ? current : []).filter(row => {
      const match = String(row && row.contentHash || '').trim().toLowerCase() === normalizedHash;
      if (match) removed = true;
      return !match;
    }),
  []);
  return removed;
}

function registryEntryKey(row) {
  return `${String(row && row.contentHash || '').trim().toLowerCase()}::${row && row.downloadId != null ? row.downloadId : ''}`;
}

// Releases committed registry rows whose downloadId no longer resolves in Thunderbird's download history; unknown/inconclusive lookups are left untouched.
export async function reconcileExportRegistry(searchDownloads, { concurrency = 20 } = {}) {
  if (typeof searchDownloads !== 'function') return { checked: 0, released: 0 };

  const rows = await storageGetArray(REGISTRY_KEY);
  const committedWithDownload = rows.filter(row =>
    row && row.reserved !== true && row.downloadId !== null && row.downloadId !== undefined
  );
  if (!committedWithDownload.length) return { checked: 0, released: 0 };

  const ids = [...new Set(committedWithDownload.map(row => String(row.downloadId)))];
  const goneIds = new Set();
  const batchSize = Math.max(1, Number(concurrency) || 20);
  for (let offset = 0; offset < ids.length; offset += batchSize) {
    const batch = ids.slice(offset, offset + batchSize);
    await Promise.all(batch.map(async id => {
      let found = null;
      try {
        found = await searchDownloads({ id: Number(id) });
      } catch (_) {
        return;
      }
      const item = Array.isArray(found) ? found[0] : null;
      const exists = item && typeof item.exists === 'boolean' ? item.exists : (item ? null : false);
      if (exists === false) goneIds.add(id);
    }));
  }
  if (!goneIds.size) return { checked: ids.length, released: 0 };

  const staleKeys = new Set(
    committedWithDownload
      .filter(row => goneIds.has(String(row.downloadId)))
      .map(registryEntryKey)
  );

  let released = 0;
  await storageUpdate(REGISTRY_KEY, current => {
    const list = Array.isArray(current) ? current : [];
    return list.filter(row => {
      if (row && row.reserved !== true && staleKeys.has(registryEntryKey(row))) {
        released += 1;
        return false;
      }
      return true;
    });
  }, []);

  return { checked: ids.length, released };
}

export async function commitExport(reservationId, entry = {}) {
  let committed = false;
  await storageUpdate(REGISTRY_KEY, current => {
    const rows = Array.isArray(current) ? current : [];
    return rows.map(row => {
      if (!row || row.reservationId !== reservationId || row.reserved !== true) return row;
      committed = true;
      const { expiresAt, reserved, ...reservation } = row;
      return { ...reservation, ...entry, reservationId: '', reserved: false, ts: Date.now() };
    });
  }, []);
  return committed;
}

export async function releaseExport(reservationId) {
  let released = false;
  await storageUpdate(REGISTRY_KEY, current => {
    const rows = Array.isArray(current) ? current : [];
    return rows.filter(row => {
      const match = !!(row && row.reservationId === reservationId && row.reserved === true);
      if (match) released = true;
      return !match;
    });
  }, []);
  return released;
}

export async function recordExport(entry = {}) {
  await storageUpdate(REGISTRY_KEY, current => {
    const rows = Array.isArray(current) ? current : [];
    return [...rows, { ...entry, ts: Date.now(), reserved: false }].slice(-REGISTRY_LIMIT);
  }, []);
}

export function buildDuplicateManager() {
  return {
    hashAttachment,
    reserveExport,
    commitExport,
    releaseExport,
    forgetExportByHash,
    recordExport,
    reconcileExportRegistry
  };
}
