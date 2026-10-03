import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRuleFile, ruleFileJson } from '../modules/ruleFile.mjs';

const rules = [{
  id: 'local-id', name: 'Счета PDF', enabled: true,
  query: 'from:supplier@example.com AND fileext:pdf',
  accountIds: ['account-1'], folderKeys: ['account-1::Inbox'],
  folder: 'Счета', saveMode: 'by_rule', basePath: 'Финансы'
}];

test('сохраняет правила в читаемый и загружаемый JSON-формат', () => {
  const json = ruleFileJson(rules);
  assert.match(json, /"when": "from:supplier@example.com AND fileext:pdf"/);
  assert.match(json, /"base_path": "Финансы"/);
  assert.deepEqual(parseRuleFile(json, index => `new-${index}`), [{
    id: 'new-0', name: 'Счета PDF', enabled: true,
    query: 'from:supplier@example.com AND fileext:pdf',
    queryLabel: 'from:supplier@example.com AND fileext:pdf',
    accountIds: ['account-1'], folderKeys: ['account-1::Inbox'], folderObjects: [],
    folder: 'Счета', saveMode: 'by_rule', basePath: 'Финансы'
  }]);
});

test('отклоняет файл с неподдерживаемым форматом и режимом сохранения', () => {
  assert.throws(() => parseRuleFile('{"format":"other","format_version":1,"rules":[]}'), /format/);
  assert.throws(() => parseRuleFile(JSON.stringify({
    format: 'inbox-weaver-rules', format_version: 1,
    rules: [{ save: { mode: 'unknown' } }]
  })), /save.mode/);
});

test('понятно сообщает об ошибке синтаксиса JSON', () => {
  assert.throws(() => parseRuleFile('{'), /кавычки, запятые и скобки/);
});
