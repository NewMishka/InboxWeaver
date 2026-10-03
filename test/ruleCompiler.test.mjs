import test from 'node:test';
import assert from 'node:assert/strict';

import { compileRules } from '../modules/ruleCompiler.mjs';

test('компилятор определяет зависимости правила от тела и вложений', () => {
  const [compiled] = compileRules([{
    name: 'Документы',
    query: 'from:example.com AND (body:договор OR fileext:pdf)'
  }]);

  assert.equal(compiled.valid, true);
  assert.equal(compiled.needsBody, true);
  assert.equal(compiled.needsAttachments, true);
  assert.equal(compiled.tree.type, 'AND');
});

test('ошибка запроса сохраняется в скомпилированном результате', () => {
  const [compiled] = compileRules([{ query: 'subject:(' }]);

  assert.equal(compiled.valid, false);
  assert.match(compiled.error, /SyntaxError|скобк|значен/i);
});
