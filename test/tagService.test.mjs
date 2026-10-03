import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clearMessageTags,
  resolveTagMap,
  tagKindForAuditStatus
} from '../core/tagService.mjs';

test('resolveTagMap uses built-in mail client tag keys when custom tags cannot be created', () => {
  const map = resolveTagMap([
    { key: '$label1', tag: 'Важное' },
    { key: '$label2', tag: 'Рабочее' },
    { key: '$label4', tag: 'К исполнению' }
  ]);

  assert.deepEqual(map, {
    processed: '$label2',
    error: '$label1',
    review: '$label4'
  });
});

test('resolveTagMap prefers plugin-owned tags when they already exist', () => {
  const map = resolveTagMap([
    { key: 'mvprocessed', tag: 'Обработано' },
    { key: 'mverror', tag: 'Ошибка' },
    { key: 'mvreview', tag: 'Требует проверки' },
    { key: '$label2', tag: 'Рабочее' }
  ]);

  assert.deepEqual(map, {
    processed: 'mvprocessed',
    error: 'mverror',
    review: 'mvreview'
  });
});

test('resolveTagMap supports English built-in tag names', () => {
  const map = resolveTagMap([
    { key: 'work-key', tag: 'Work' },
    { key: 'important-key', tag: 'Important' },
    { key: 'todo-key', tag: 'To Do' }
  ]);

  assert.deepEqual(map, {
    processed: 'work-key',
    error: 'important-key',
    review: 'todo-key'
  });
});

test('tagKindForAuditStatus maps processing outcomes consistently', () => {
  assert.equal(tagKindForAuditStatus('Обработано'), 'processed');
  assert.equal(tagKindForAuditStatus('Пропущено как дубль'), 'processed');
  assert.equal(tagKindForAuditStatus('Ошибка'), 'error');
  assert.equal(tagKindForAuditStatus('Обработано частично'), 'review');
  assert.equal(tagKindForAuditStatus('Ожидает сохранения'), 'review');
  assert.equal(tagKindForAuditStatus('Совпало правило'), 'review');
  assert.equal(tagKindForAuditStatus('Проверено'), '');
});

test('clearMessageTags preserves user tags', async () => {
  const originalMessenger = globalThis.messenger;
  let currentTags = ['user-project', 'mvprocessed'];
  globalThis.messenger = {
    messages: {
      tags: {
        list: async () => [
          { key: 'mvprocessed', tag: 'Обработано' },
          { key: 'mverror', tag: 'Ошибка' },
          { key: 'mvreview', tag: 'Требует проверки' }
        ],
        create: async () => {}
      },
      get: async () => ({ tags: [...currentTags] }),
      update: async (_messageId, patch) => {
        currentTags = [...patch.tags];
      }
    }
  };

  try {
    const result = await clearMessageTags([10]);
    assert.deepEqual(currentTags, ['user-project']);
    assert.equal(result.cleared, 1);
    assert.equal(result.failed, 0);
  } finally {
    globalThis.messenger = originalMessenger;
  }
});
