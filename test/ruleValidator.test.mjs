import test from 'node:test';
import assert from 'node:assert/strict';

import { validateRuleDefinitions } from '../modules/ruleValidator.mjs';

const validRule = {
  name: 'PDF от поставщика',
  query: 'from:supplier@example.com AND fileext:pdf',
  folder: 'Invoices',
  accountIds: ['account1'],
  folderKeys: ['account1::Inbox'],
  enabled: true
};

test('принимает корректное правило без обращения к почте', () => {
  const result = validateRuleDefinitions([validRule]);
  assert.equal(result.total, 1);
  assert.equal(result.valid, 1);
  assert.equal(result.invalid, 0);
  assert.deepEqual(result.rules[0].errors, []);
});

test('находит ошибки структуры и синтаксиса', () => {
  const result = validateRuleDefinitions([{
    name: '',
    query: 'subject:',
    folder: '',
    accountIds: [],
    folderKeys: []
  }]);

  assert.equal(result.invalid, 1);
  assert.equal(result.rules[0].errors.length, 5);
  assert.match(result.rules[0].errors.join(' '), /Ошибка условия/);
});

test('предупреждает о выключенных и одинаковых правилах', () => {
  const first = { ...validRule, enabled: false };
  const second = { ...validRule };
  const result = validateRuleDefinitions([first, second]);

  assert.equal(result.valid, 2);
  assert.equal(result.rules[0].warnings.length, 2);
  assert.match(result.rules[0].warnings.join(' '), /выключено/);
  assert.match(result.rules[1].warnings.join(' '), /другое правило/);
});
