import { getSettings } from './settingsService.mjs';

const TAG_DEFS = {
  processed: { key: 'mvprocessed', name: 'Обработано', color: '#0a7d33' },
  error: { key: 'mverror', name: 'Ошибка', color: '#b42318' },
  review: { key: 'mvreview', name: 'Требует проверки', color: '#f0a800' }
};

const SYSTEM_TAGS = {
  processed: { key: '$label2', names: ['Рабочее', 'Work'] },
  error: { key: '$label1', names: ['Важное', 'Important'] },
  review: { key: '$label4', names: ['К исполнению', 'To Do'] }
};

let tagKeyCache = null;

async function listAllTags() {
  const messagesApi = messenger.messages;
  if (messagesApi && messagesApi.tags && messagesApi.tags.list) {
    return await messagesApi.tags.list();
  }
  if (messagesApi && messagesApi.listTags) {
    return await messagesApi.listTags();
  }
  return [];
}

async function createTag(key, name, color) {
  const messagesApi = messenger.messages;
  if (messagesApi && messagesApi.tags && messagesApi.tags.create) {
    return await messagesApi.tags.create(key, name, color);
  }
  if (messagesApi && messagesApi.createTag) {
    return await messagesApi.createTag(key, name, color);
  }
  throw new Error('tags API not available');
}

export async function ensureTags() {
  const existing = await listAllTags();
  const keys = new Set((existing || []).map(tag => tag.key));

  for (const status of Object.keys(TAG_DEFS)) {
    const definition = TAG_DEFS[status];
    if (!keys.has(definition.key)) {
      try {
        await createTag(definition.key, definition.name, definition.color);
      } catch (_) {}
    }
  }

  const after = await listAllTags();
  const map = resolveTagMap(after);

  if (!(after || []).length && messenger.messages?.update) {
    for (const [status, definition] of Object.entries(SYSTEM_TAGS)) {
      map[status] = definition.key;
    }
  }

  tagKeyCache = map;
  return map;
}

export function resolveTagMap(tags) {
  const existing = Array.isArray(tags) ? tags : [];
  const keys = new Set(existing.map(tag => String(tag?.key || '')));
  const map = {};

  for (const status of Object.keys(TAG_DEFS)) {
    const own = TAG_DEFS[status];
    const system = SYSTEM_TAGS[status];
    if (keys.has(own.key)) {
      map[status] = own.key;
      continue;
    }
    if (keys.has(system.key)) {
      map[status] = system.key;
      continue;
    }
    const names = new Set(system.names.map(name => name.toLocaleLowerCase('ru')));
    const found = existing.find(tag =>
      names.has(String(tag?.tag || '').trim().toLocaleLowerCase('ru'))
    );
    if (found?.key) map[status] = found.key;
  }

  return map;
}

export function tagKindForAuditStatus(auditStatus) {
  const status = String(auditStatus || '').trim();
  if (status === 'Обработано' || status === 'Пропущено как дубль') return 'processed';
  if (status === 'Ошибка') return 'error';
  if (
    status === 'Обработано частично' ||
    status === 'Ожидает сохранения' ||
    status === 'Совпало правило'
  ) return 'review';
  return '';
}

export async function applyMessageTag(messageId, statusKind) {
  try {
    if (!tagKeyCache) await ensureTags();

    const tagKey = tagKeyCache && tagKeyCache[statusKind];
    if (!tagKey) return;

    let current = [];
    try {
      const header = await messenger.messages.get(messageId);
      current = (header && header.tags) || [];
    } catch (_) {}

    const ownKeys = Object.values(tagKeyCache || {});
    const next = [...current.filter(tag => !ownKeys.includes(tag)), tagKey];
    await messenger.messages.update(messageId, { tags: next });
  } catch (_) {}
}

export async function clearMessageTags(messageIds) {
  const ids = [...new Set(
    (Array.isArray(messageIds) ? messageIds : [])
      .map(value => String(value))
      .filter(Boolean)
  )];

  if (!ids.length) {
    return { cleared: 0, failed: 0, diagnostics: [] };
  }

  let cleared = 0;
  let failed = 0;
  const diagnostics = [];
  if (!tagKeyCache) await ensureTags();
  const ownKeys = new Set(Object.values(tagKeyCache || {}).map(String));

  for (const id of ids) {
    try {
      const header = await messenger.messages.get(Number(id));
      const current = Array.isArray(header && header.tags)
        ? header.tags.map(String)
        : [];

      const next = current.filter(tag => !ownKeys.has(tag));
      if (next.length === current.length) {
        diagnostics.push({
          type: 'tags',
          messageId: String(id),
          before: current,
          after: current,
          ok: true,
          note: 'no managed tags on message'
        });
        continue;
      }

      let updateError = '';
      try {
        await messenger.messages.update(Number(id), { tags: next });
      } catch (error) {
        updateError = String(error);
      }

      const afterHeader = await messenger.messages.get(Number(id));
      const after = Array.isArray(afterHeader && afterHeader.tags)
        ? afterHeader.tags.map(String)
        : [];
      const ok = !updateError &&
        after.length === next.length &&
        after.every((tag, index) => tag === next[index]);

      diagnostics.push({
        type: 'tags',
        messageId: String(id),
        before: current,
        after,
        ok,
        error: updateError || '',
        note: ok
          ? 'tags cleared'
          : (!updateError
              ? 'update returned without error but tags still present'
              : '')
      });

      if (ok) cleared += 1;
      else failed += 1;
    } catch (error) {
      failed += 1;
      diagnostics.push({
        type: 'tags',
        messageId: String(id),
        before: [],
        after: [],
        ok: false,
        error: String(error),
        note: 'messages.get/update failed'
      });
    }
  }

  return { cleared, failed, diagnostics };
}

export async function diagnoseTags() {
  const messagesApi = messenger.messages;
  const result = {
    hasTagsNamespace: !!(messagesApi && messagesApi.tags),
    hasTagsList: !!(
      messagesApi &&
      messagesApi.tags &&
      messagesApi.tags.list
    ),
    hasTagsCreate: !!(
      messagesApi &&
      messagesApi.tags &&
      messagesApi.tags.create
    ),
    hasListTags: !!(messagesApi && messagesApi.listTags),
    hasCreateTag: !!(messagesApi && messagesApi.createTag),
    hasUpdate: !!(messagesApi && messagesApi.update),
    existingTags: [],
    created: false,
    mappedTags: {},
    error: ''
  };

  try {
    const existing = await listAllTags();
    result.existingTags = (existing || []).map(tag => ({
      key: tag.key,
      tag: tag.tag
    }));
  } catch (error) {
    result.error = 'list: ' + error;
  }

  try {
    tagKeyCache = null;
    await ensureTags();
    result.mappedTags = { ...(tagKeyCache || {}) };
    result.created = !!(
      tagKeyCache &&
      Object.keys(TAG_DEFS).every(status => tagKeyCache[status])
    );
    const existing = await listAllTags();
    result.existingTags = (existing || []).map(tag => ({
      key: tag.key,
      tag: tag.tag
    }));
  } catch (error) {
    result.error =
      (result.error ? result.error + '; ' : '') +
      'create: ' +
      error;
  }

  return result;
}

export async function applyResultFeedback(messageId, auditStatus, subject) {
  const settings = await getSettings();
  const tagsOn = settings.enableTags === true;
  const notifyOn = settings.enableNotifications === true;

  if (tagsOn) {
    const statusKind = tagKindForAuditStatus(auditStatus);
    if (statusKind) await applyMessageTag(messageId, statusKind);
  }

  if (
    notifyOn &&
    (
      auditStatus === 'Ошибка' ||
      auditStatus === 'Обработано частично'
    )
  ) {
    try {
      messenger.notifications.create({
        type: 'basic',
        title: 'InboxWeaver — Менеджер писем',
        message:
          `Письмо совпало по правилу, но не обработано полностью: ` +
          `«${subject || ''}» (${auditStatus})`
      });
    } catch (_) {}
  }
}
