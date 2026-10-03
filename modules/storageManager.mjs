const DEFAULT_EXPORT_STATE = { running: false, processed: 0, saved: 0, done: false, error: '', startedAt: 0, finishedAt: 0 };
const updateQueues = new Map();

export async function get(defaultsOrKey, fallback) {
  if (typeof defaultsOrKey === 'string') {
    const state = await messenger.storage.local.get({ [defaultsOrKey]: fallback });
    return state[defaultsOrKey];
  }
  return await messenger.storage.local.get(defaultsOrKey || {});
}

export async function set(values) {
  await messenger.storage.local.set(values || {});
}

export async function remove(keys) {
  await messenger.storage.local.remove(keys);
}

export async function has(key) {
  const state = await messenger.storage.local.get(key);
  return Object.prototype.hasOwnProperty.call(state || {}, key);
}

export async function update(key, updater, fallback) {
  const queueKey = String(key);
  const previous = updateQueues.get(queueKey) || Promise.resolve();
  const operation = previous
    .catch(() => undefined)
    .then(async () => {
      const current = await get(key, fallback);
      const next = await updater(current);
      await set({ [key]: next });
      return next;
    });
  updateQueues.set(queueKey, operation);
  try {
    return await operation;
  } finally {
    if (updateQueues.get(queueKey) === operation) updateQueues.delete(queueKey);
  }
}

export async function getArray(key) {
  const value = await get(key, []);
  return Array.isArray(value) ? value : [];
}

export async function setArray(key, value) {
  await update(key, () => Array.isArray(value) ? value : [], []);
}

export async function appendToArray(key, entry, limit = 500) {
  return await update(key, rows => {
    const list = Array.isArray(rows) ? rows : [];
    list.push(entry);
    return Number(limit) > 0 ? list.slice(-Number(limit)) : list;
  }, []);
}

export async function appendManyToArray(key, entries, limit = 500) {
  if (!Array.isArray(entries) || !entries.length) return;
  return await update(key, rows => {
    const list = Array.isArray(rows) ? rows : [];
    const merged = list.concat(entries);
    return Number(limit) > 0 ? merged.slice(-Number(limit)) : merged;
  }, []);
}

export async function backup(keys) {
  if (Array.isArray(keys) && keys.length) return await messenger.storage.local.get(keys);
  return await messenger.storage.local.get(null);
}

export async function restore(snapshot) {
  await set(snapshot || {});
}

export async function migrate() {
  return { status: 'ok', version: '1.0.163', reason: 'No schema migration required' };
}

export async function getExportRegistry() {
  return await getArray('exportRegistry');
}

export async function addExportRegistryEntry(entry) {
  await appendToArray('exportRegistry', entry, 20000);
}

export async function getExportState() {
  return (await get('exportState', DEFAULT_EXPORT_STATE)) || DEFAULT_EXPORT_STATE;
}

export async function setExportState(patch) {
  return await update(
    'exportState',
    current => ({ ...DEFAULT_EXPORT_STATE, ...(current || {}), ...(patch || {}) }),
    DEFAULT_EXPORT_STATE
  );
}
