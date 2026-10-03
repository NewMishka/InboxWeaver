import test from 'node:test';
import assert from 'node:assert/strict';
import { currentRuleNames } from '../modules/currentRuleNames.mjs';

test('возвращает только имена существующих правил без повторов', () => {
  assert.deepEqual(currentRuleNames([
    { name: 'Архив' },
    { name: 'Счета' },
    { name: 'Счета' },
    { name: '  ' },
    null
  ]), ['Архив', 'Счета']);
});
