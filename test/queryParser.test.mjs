import test from 'node:test';
import assert from 'node:assert/strict';

import { parseQuery, tokenize } from '../modules/queryParser.mjs';
import { matchesQuery } from '../modules/queryMatcher.mjs';

const message = {
  sender_email: 'sender@example.com',
  subject: 'Ежемесячный отчёт',
  body: 'Документы приложены',
  attachments: [{ name: 'report.pdf' }]
};

test('разбирает и применяет составное правило', () => {
  const query = parseQuery('from:sender@example.com AND (subject:отчёт OR fileext:pdf)');
  assert.equal(matchesQuery(query, message), true);
});

test('сохраняет поддержку точной фразы и исключения', () => {
  const query = parseQuery('subject:"Ежемесячный отчёт" -fileext:xlsx');
  assert.equal(matchesQuery(query, message), true);
});

test('исключение отправителя применяется ко всем веткам сложного правила', () => {
  const query = parseQuery(
    '(subject:счёт OR fileext:pdf) AND (-from:blocked@example.com)'
  );

  assert.equal(matchesQuery(query, {
    ...message,
    subject: 'Счёт на оплату',
    sender_email: 'blocked@example.com'
  }), false);
  assert.equal(matchesQuery(query, {
    ...message,
    subject: 'Другое письмо',
    sender_email: 'blocked@example.com'
  }), false);
  assert.equal(matchesQuery(query, {
    ...message,
    subject: 'Другое письмо',
    sender_email: 'supplier@example.com'
  }), true);
});

test('пустой запрос остаётся правилом без ограничений', () => {
  assert.equal(parseQuery('   '), null);
  assert.equal(matchesQuery(null, message), true);
});

test('отклоняет поле без значения', () => {
  assert.throws(() => parseQuery('subject:'), /Ожидалось значение условия/);
});

test('отклоняет незакрытую кавычку', () => {
  assert.throws(() => tokenize('subject:"отчёт'), /Незакрытая кавычка/);
});

test('отклоняет незакрытую группу', () => {
  assert.throws(() => parseQuery('(subject:отчёт OR fileext:pdf'), /Не закрыта скобка/);
});

test('отклоняет лишнюю закрывающую скобку', () => {
  assert.throws(() => parseQuery('subject:отчёт)'), /Лишняя закрывающая скобка/);
});

test('отклоняет пустую группу и оператор без операнда', () => {
  assert.throws(() => parseQuery('()'), /Пустая группа условий/);
  assert.throws(() => parseQuery('subject:отчёт AND'), /Ожидалось значение условия/);
  assert.throws(() => parseQuery('-'), /Ожидалось значение условия/);
});
