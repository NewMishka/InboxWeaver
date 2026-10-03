import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ruleAppliesToAccount,
  selectForceExportFolders
} from '../core/accountService.mjs';

const account = {
  id: 'account-1',
  folders: [
    {
      name: 'Inbox',
      path: '/Inbox',
      subFolders: [{ name: 'Invoices', path: '/Inbox/Invoices' }]
    },
    { name: 'Archive', path: '/Archive' }
  ]
};

test('область правила важнее устаревшего общего списка ящиков', () => {
  const rule = { accountIds: ['account-1'] };
  assert.equal(ruleAppliesToAccount(rule, 'account-1', ['account-2']), true);
  assert.equal(ruleAppliesToAccount(rule, 'account-2', ['account-2']), false);
});

test('правило без папки сканирует все папки подходящего ящика', () => {
  const folders = selectForceExportFolders(
    account,
    [{ accountIds: ['account-1'], folderKeys: [], folderObjects: [] }],
    []
  );
  assert.deepEqual(folders.map(folder => folder.path), [
    '/Inbox',
    '/Inbox/Invoices',
    '/Archive'
  ]);
});

test('правило с областью сканирует только выбранные папки', () => {
  const folders = selectForceExportFolders(account, [{
    accountIds: ['account-1'],
    folderKeys: ['account-1::Inbox/Invoices'],
    folderObjects: []
  }]);
  assert.deepEqual(folders.map(folder => folder.path), ['/Inbox/Invoices']);
});
