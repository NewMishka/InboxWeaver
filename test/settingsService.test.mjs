import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_SETTINGS,
  getRules,
  getSettings
} from '../core/settingsService.mjs';

function storageWith(value) {
  return {
    async get() {
      return value;
    }
  };
}

test('getSettings restores defaults missing from an older configuration', async () => {
  const settings = await getSettings(storageWith({
    settings: {
      basePath: 'Архив',
      liveMode: false,
      selectedAccounts: [17]
    }
  }));

  assert.deepEqual(settings, {
    ...DEFAULT_SETTINGS,
    basePath: 'Архив',
    liveMode: false,
    selectedAccounts: ['17']
  });
});

test('getSettings returns an independent default account list', async () => {
  const settings = await getSettings(storageWith({ settings: null }));

  settings.selectedAccounts.push('account-1');
  assert.deepEqual(DEFAULT_SETTINGS.selectedAccounts, []);
});

test('getRules excludes disabled and invalid entries', async () => {
  const rules = await getRules(storageWith({
    rules: [
      { id: 'enabled' },
      { id: 'disabled', enabled: false },
      null
    ]
  }));

  assert.deepEqual(rules, [{ id: 'enabled' }]);
});
