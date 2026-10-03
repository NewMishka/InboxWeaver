export const PAGE_SIZES = Object.freeze([20, 50, 100]);

export function normalizePageSize(value, fallback = PAGE_SIZES[0]) {
  const size = Number(value);
  return PAGE_SIZES.includes(size) ? size : fallback;
}

export function paginate(items, requestedPage = 1, requestedPageSize = PAGE_SIZES[0]) {
  const list = Array.isArray(items) ? items : [];
  const pageSize = normalizePageSize(requestedPageSize);
  const totalItems = list.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const page = Math.min(totalPages, Math.max(1, Number(requestedPage) || 1));
  const startIndex = (page - 1) * pageSize;
  const endIndex = Math.min(totalItems, startIndex + pageSize);

  return {
    items: list.slice(startIndex, endIndex),
    page,
    pageSize,
    totalItems,
    totalPages,
    startIndex,
    endIndex,
    hasPrevious: page > 1,
    hasNext: page < totalPages
  };
}

export function groupAttachmentRows(rows) {
  const groups = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row, index) => {
    const key = row && row.messageId
      ? `message:${row.messageId}`
      : `legacy:${index}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ row, index });
  });
  return [...groups.values()];
}
