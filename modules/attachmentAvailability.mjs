export function reconcileAttachmentAvailability(attachmentLogs = [], downloadItems = []) {
  const downloadsById = new Map(
    (Array.isArray(downloadItems) ? downloadItems : [])
      .filter(item => item && item.id !== undefined && item.id !== null)
      .map(item => [String(item.id), item])
  );

  return (Array.isArray(attachmentLogs) ? attachmentLogs : []).map(row => {
    const downloadId = row && row.downloadId !== undefined && row.downloadId !== null
      ? String(row.downloadId)
      : '';
    const download = downloadId ? downloadsById.get(downloadId) : null;
    const fileExists = download && typeof download.exists === 'boolean'
      ? download.exists
      : null;
    return { ...row, fileExists };
  });
}

export async function queryDownloadItemsForLogs(
  attachmentLogs = [],
  searchDownloads,
  concurrency = 20
) {
  if (typeof searchDownloads !== 'function') return [];
  const ids = [...new Map(
    (Array.isArray(attachmentLogs) ? attachmentLogs : [])
      .filter(row =>
        row &&
        row.status === 'success' &&
        row.downloadId !== undefined &&
        row.downloadId !== null
      )
      .map(row => [String(row.downloadId), row.downloadId])
  ).values()];
  const found = [];
  const batchSize = Math.max(1, Number(concurrency || 20));

  for (let offset = 0; offset < ids.length; offset += batchSize) {
    const batch = ids.slice(offset, offset + batchSize);
    const results = await Promise.all(batch.map(async id => {
      try {
        const items = await searchDownloads({ id });
        return Array.isArray(items) ? items : [];
      } catch (_) {
        return [];
      }
    }));
    found.push(...results.flat());
  }

  return found;
}
