(function () {
  async function get(defaultsOrKey, fallback) {
    if (typeof defaultsOrKey === 'string') {
      const state = await messenger.storage.local.get({ [defaultsOrKey]: fallback });
      return state[defaultsOrKey];
    }
    return await messenger.storage.local.get(defaultsOrKey || {});
  }
  async function set(values) { await messenger.storage.local.set(values || {}); }
  async function remove(keys) { await messenger.storage.local.remove(keys); }
  async function update(key, updater, fallback) {
    const current = await get(key, fallback);
    const next = await updater(current);
    await set({ [key]: next });
    return next;
  }
  async function getArray(key) {
    const value = await get(key, []);
    return Array.isArray(value) ? value : [];
  }
  async function setArray(key, value) { await set({ [key]: Array.isArray(value) ? value : [] }); }
  window.StorageManager = { get, set, remove, update, getArray, setArray };
}());
