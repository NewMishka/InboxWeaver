import {
  hashAttachment,
  reserveExport,
  commitExport,
  releaseExport
} from './duplicateManager.mjs';

export async function saveUniqueAttachment({
  file,
  fingerprint = '',
  entry = {},
  saveBuffer,
  duplicateManager = {
    hashAttachment,
    reserveExport,
    commitExport,
    releaseExport
  }
}) {
  if (typeof saveBuffer !== 'function') throw new TypeError('saveBuffer is required');

  const { buffer, contentHash } = await duplicateManager.hashAttachment(file);
  const reservation = await duplicateManager.reserveExport({
    contentHash,
    fingerprint,
    entry: { ...entry, contentHash }
  });
  if (!reservation.claimed) {
    return {
      status: 'duplicate',
      saved: false,
      contentHash,
      duplicateOf: reservation.duplicateOf || null
    };
  }

  try {
    const download = await saveBuffer(buffer);
    const committed = await duplicateManager.commitExport(reservation.reservationId, {
      ...entry,
      ...download,
      contentHash
    });
    if (!committed) throw new Error('Failed to commit attachment reservation');
    return {
      status: 'saved',
      saved: true,
      contentHash,
      download
    };
  } catch (error) {
    await duplicateManager.releaseExport(reservation.reservationId);
    throw error;
  }
}
