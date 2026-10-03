import test from 'node:test';
import assert from 'node:assert/strict';

import {
  aggregateStatistics,
  classifyAuditStatus,
  groupStatisticsMessages,
  projectAttachmentStates,
  OUTCOME,
  OUTCOME_LABELS
} from '../modules/statisticsAggregator.mjs';

const audits = [
  { messageId: 1, timestamp: 1, status: 'Ошибка', senderEmail: 'USER@example.com', checkedDate: '01.07.2026', matchedRuleName: 'PDF' },
  { messageId: 1, timestamp: 2, status: 'Обработано', senderEmail: 'user@example.com', checkedDate: '01.07.2026', matchedRuleName: 'PDF' },
  { messageId: 2, timestamp: 3, status: 'Пропущено как дубль', senderEmail: 'user@example.com', checkedDate: '02.07.2026', matchedRuleName: 'PDF' },
  { messageId: 3, timestamp: 4, status: 'Обработано частично', senderEmail: 'other@example.com', checkedDate: '03.07.2026', matchedRuleName: 'DOC' },
  { messageId: 4, timestamp: 5, status: 'Совпало правило, вложений нет', senderEmail: 'third@example.com', checkedDate: '04.07.2026', matchedRuleName: 'DOC' }
];

const attachments = [
  { messageId: 1, status: 'success', attachmentSize: 100, senderEmail: 'user@example.com', receivedDate: '01.07.2026', receivedTime: '10:15:00', importance: 'high', ruleName: 'PDF' },
  { messageId: 3, status: 'success', attachmentSize: 200, senderEmail: 'other@example.com', receivedDate: '03.07.2026', ruleName: 'DOC' },
  { messageId: 3, status: 'error', attachmentSize: 300, senderEmail: 'other@example.com', receivedDate: '03.07.2026', ruleName: 'DOC' }
];

test('классифицирует бизнес-исходы независимо от attachment status', () => {
  assert.equal(classifyAuditStatus('Обработано'), OUTCOME.PROCESSED);
  assert.equal(classifyAuditStatus('Пропущено как дубль'), OUTCOME.DUPLICATE);
  assert.equal(classifyAuditStatus('Совпало правило, вложений нет'), OUTCOME.NO_ATTACHMENTS);
  assert.equal(classifyAuditStatus('Ожидает сохранения'), OUTCOME.PENDING);
  assert.equal(OUTCOME_LABELS[OUTCOME.DUPLICATE], 'Дубль');
});

test('использует последний аудит каждого письма и считает KPI по разным журналам', () => {
  const result = aggregateStatistics({ auditLogs: audits, attachmentLogs: attachments });
  assert.equal(result.kpi.matchedMessages, 4);
  assert.equal(result.kpi.processedMessages, 1);
  assert.equal(result.kpi.savedAttachments, 2);
  assert.equal(result.kpi.attention, 1);
  assert.equal(result.kpi.duplicates, 1);
  assert.equal(result.kpi.noAttachments, 1);
  assert.equal(result.kpi.uniqueSenders, 3);
  assert.equal(result.kpi.savedBytes, 300);
  assert.equal(result.kpi.successRate, 50);
  assert.equal(result.matchedMessages.length, 4);
});

test('KPI считает одну фактическую загрузку один раз', () => {
  const result = aggregateStatistics({
    auditLogs: [{ messageId: 10, timestamp: 1, status: 'Обработано', matchedRuleName: 'PDF' }],
    attachmentLogs: [
      { id: 'a', messageId: 10, status: 'success', downloadId: 500, attachmentSize: 1024 },
      { id: 'b', messageId: 10, status: 'success', downloadId: 500, attachmentSize: 1024 }
    ]
  });

  assert.equal(result.kpi.savedAttachments, 1);
  assert.equal(result.kpi.savedBytes, 1024);
});

test('проекция сохраняет успешное состояние после повторной попытки-дубля', () => {
  const states = projectAttachmentStates([
    {
      id: 'saved',
      timestamp: 1,
      messageId: 10,
      partName: '1.2',
      ruleName: 'PDF',
      status: 'success',
      downloadId: 500
    },
    {
      id: 'duplicate-attempt',
      timestamp: 2,
      messageId: 10,
      partName: '1.2',
      ruleName: 'PDF',
      status: 'duplicate'
    }
  ]);

  assert.equal(states.length, 1);
  assert.equal(states[0].status, 'success');
  assert.equal(states[0].downloadId, 500);
});

test('сводка вложений предпочитает success дублю той же части по другому правилу', () => {
  const result = aggregateStatistics({
    auditLogs: [{
      messageId: 10,
      timestamp: 3,
      status: 'Обработано',
      matchedRuleName: 'Основное'
    }],
    attachmentLogs: [
      {
        messageId: 10,
        timestamp: 1,
        partName: '1.2',
        attachmentName: 'report.pdf',
        ruleName: 'Основное',
        status: 'success',
        downloadId: 500
      },
      {
        messageId: 10,
        timestamp: 2,
        partName: '1.2',
        attachmentName: 'report.pdf',
        ruleName: 'Дополнительное',
        status: 'duplicate'
      }
    ]
  });

  assert.equal(result.messages[0].matchedAttachments.length, 1);
  assert.equal(result.messages[0].matchedAttachments[0].status, 'success');
  assert.equal(result.attachments.length, 1);
});

test('результат письма содержит только вложения, попавшие под правила', () => {
  const result = aggregateStatistics({
    auditLogs: [{
      messageId: 11,
      timestamp: 1,
      status: 'Ожидает сохранения',
      matchedRuleName: 'PDF'
    }],
    attachmentLogs: [
      {
        messageId: 11,
        timestamp: 1,
        partName: '1.2',
        attachmentName: 'matched.pdf',
        ruleName: 'PDF',
        status: 'pending'
      },
      {
        messageId: 11,
        timestamp: 2,
        partName: '1.3',
        attachmentName: '',
        ruleName: '',
        status: 'pending'
      }
    ]
  });

  assert.deepEqual(
    result.matchedMessages[0].matchedAttachments.map(row => row.name),
    ['matched.pdf']
  );
});

test('результат письма содержит все совпавшие правила без повторов', () => {
  const input = {
    auditLogs: [{
      messageId: 12,
      timestamp: 1,
      status: 'Ожидает сохранения',
      matchedRuleName: 'Первое'
    }],
    attachmentLogs: [
      {
        messageId: 12,
        partName: '1.2',
        attachmentName: 'report.pdf',
        ruleName: 'Первое',
        ruleFolder: 'A',
        status: 'pending'
      },
      {
        messageId: 12,
        partName: '1.2',
        attachmentName: 'report.pdf',
        ruleName: 'Второе',
        ruleFolder: 'B',
        status: 'pending'
      }
    ]
  };
  const result = aggregateStatistics(input);

  assert.deepEqual(
    result.matchedMessages[0].matchedRules.map(rule => rule.name),
    ['Первое', 'Второе']
  );
  assert.deepEqual(result.options.ruleNames, ['Второе', 'Первое']);

  const filtered = aggregateStatistics({
    ...input,
    filters: { ruleName: 'Второе' }
  });
  assert.equal(filtered.matchedMessages.length, 1);
  assert.equal(filtered.matchedMessages[0].messageId, 12);
});

test('не дублирует имя правила при разных служебных данных вложений', () => {
  const result = aggregateStatistics({
    auditLogs: [{
      messageId: 13,
      timestamp: 1,
      status: 'Ожидает сохранения',
      matchedRuleName: 'Документы'
    }],
    attachmentLogs: [
      {
        messageId: 13,
        partName: '1.2',
        attachmentName: 'report.pdf',
        ruleName: 'Документы',
        ruleQuery: 'fileext:pdf',
        ruleFolder: 'PDF',
        status: 'pending'
      },
      {
        messageId: 13,
        partName: '1.3',
        attachmentName: 'report.docx',
        ruleName: 'документы',
        ruleQuery: 'fileext:docx',
        ruleFolder: 'DOCX',
        status: 'pending'
      }
    ]
  });

  assert.equal(result.matchedMessages[0].matchedRules.length, 1);
  assert.equal(result.matchedMessages[0].matchedRules[0].name, 'Документы');
});

test('не выводит проверенные и не совпавшие письма в результатах правил', () => {
  const result = aggregateStatistics({
    auditLogs: [
      ...audits,
      { messageId: 20, timestamp: 20, status: 'Проверено', subject: 'Без правила' },
      { messageId: 21, timestamp: 21, status: 'Не подошло ни под одно правило', subject: 'Не совпало' }
    ],
    attachmentLogs: attachments
  });

  assert.equal(result.kpi.matchedMessages, 4);
  assert.equal(result.matchedMessages.length, 4);
  assert.equal(result.matchedMessages.some(row => row.messageId === 20), false);
  assert.equal(result.matchedMessages.some(row => row.messageId === 21), false);
});

test('сохраняет историческое попадание под правило, подтверждённое журналом вложений', () => {
  const result = aggregateStatistics({
    auditLogs: [{
      messageId: 30,
      timestamp: 30,
      status: 'Проверено',
      subject: 'Старое письмо'
    }],
    attachmentLogs: [{
      messageId: 30,
      status: 'success',
      ruleName: 'Историческое правило',
      attachmentName: 'report.pdf'
    }]
  });

  assert.equal(result.matchedMessages.length, 1);
  assert.equal(result.matchedMessages[0].outcome, OUTCOME.PROCESSED);
  assert.equal(result.matchedMessages[0].ruleName, 'Историческое правило');
});

test('строит результат из журнала вложений, если аудит письма отсутствует', () => {
  const result = aggregateStatistics({
    auditLogs: [],
    attachmentLogs: [{
      messageId: 31,
      status: 'success',
      ruleName: 'PDF',
      attachmentName: 'document.pdf',
      subject: 'Документ'
    }]
  });

  assert.equal(result.matchedMessages.length, 1);
  assert.equal(result.matchedMessages[0].messageId, '31');
  assert.equal(result.matchedMessages[0].ruleName, 'PDF');
});

test('применяет одинаковые фильтры к KPI и вложениям', () => {
  const result = aggregateStatistics({
    auditLogs: audits,
    attachmentLogs: attachments,
    filters: { ruleName: 'DOC', dateFrom: '2026-07-03', dateTo: '2026-07-03' }
  });
  assert.equal(result.kpi.matchedMessages, 1);
  assert.equal(result.kpi.attention, 1);
  assert.equal(result.kpi.savedAttachments, 1);
  assert.equal(result.attachments.length, 1);
});

test('фильтр дублей не показывает строки сохранённых вложений', () => {
  const result = aggregateStatistics({
    auditLogs: audits,
    attachmentLogs: attachments,
    filters: { status: OUTCOME.DUPLICATE }
  });
  assert.equal(result.messages.length, 1);
  assert.equal(result.kpi.duplicates, 1);
  assert.equal(result.attachments.length, 0);
});

test('дополняет письмо датой получения и важностью из журнала вложений', () => {
  const result = aggregateStatistics({
    auditLogs: audits.map(row =>
      row.messageId === 1 ? { ...row, importance: 'unknown' } : row
    ),
    attachmentLogs: attachments,
    filters: { importance: 'high' }
  });

  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].messageId, 1);
  assert.equal(result.messages[0].receivedDate, '01.07.2026');
  assert.equal(result.messages[0].receivedTime, '10:15:00');
  assert.equal(result.messages[0].importance, 'high');
});

test('для группировки выбирает известную важность из нескольких записей вложений', () => {
  const result = aggregateStatistics({
    auditLogs: [{
      messageId: 40,
      timestamp: 1,
      status: 'Обработано',
      importance: 'unknown'
    }],
    attachmentLogs: [
      { messageId: 40, timestamp: 1, status: 'success', importance: 'unknown' },
      { messageId: 40, timestamp: 2, status: 'success', importance: 'low' }
    ]
  });

  assert.equal(result.matchedMessages[0].importance, 'low');
});

test('удалённое вложение не учитывается в KPI сохранённых файлов и объёме', () => {
  const result = aggregateStatistics({
    auditLogs: [{ messageId: 41, timestamp: 1, status: 'Обработано' }],
    attachmentLogs: [{
      messageId: 41,
      timestamp: 1,
      status: 'success',
      attachmentSize: 1024,
      fileExists: false
    }]
  });

  assert.equal(result.kpi.savedAttachments, 0);
  assert.equal(result.kpi.savedBytes, 0);
  assert.equal(result.attachments.length, 0);
  assert.equal(result.matchedMessages[0].canSaveAttachments, true);
});

test('таблица сохранённых вложений исключает ожидание, дубли и ошибки', () => {
  const result = aggregateStatistics({
    auditLogs: [
      { messageId: 51, timestamp: 1, status: 'Обработано', matchedRuleName: 'PDF' },
      { messageId: 52, timestamp: 2, status: 'Ожидает сохранения', matchedRuleName: 'PDF' },
      { messageId: 53, timestamp: 3, status: 'Пропущено как дубль', matchedRuleName: 'PDF' },
      { messageId: 54, timestamp: 4, status: 'Ошибка', matchedRuleName: 'PDF' }
    ],
    attachmentLogs: [
      { messageId: 51, partName: '1', ruleName: 'PDF', status: 'success', downloadId: 1 },
      { messageId: 52, partName: '1', ruleName: 'PDF', status: 'pending' },
      { messageId: 53, partName: '1', ruleName: 'PDF', status: 'duplicate' },
      { messageId: 54, partName: '1', ruleName: 'PDF', status: 'error' }
    ]
  });

  assert.deepEqual(result.attachments.map(row => row.messageId), [51]);
  assert.equal(result.kpi.savedAttachments, 1);
});

test('ожидающее письмо становится обработанным только при наличии сохранённого файла', () => {
  const auditLogs = [{
    messageId: 42,
    timestamp: 2,
    status: 'Ожидает сохранения',
    matchedRuleName: 'PDF'
  }];
  const pending = aggregateStatistics({ auditLogs });
  const saved = aggregateStatistics({
    auditLogs,
    attachmentLogs: [{
      messageId: 42,
      timestamp: 1,
      status: 'success',
      attachmentSize: 100,
      fileExists: true
    }]
  });

  assert.equal(pending.matchedMessages[0].outcome, OUTCOME.PENDING);
  assert.equal(pending.matchedMessages[0].processedCount, 0);
  assert.equal(saved.matchedMessages[0].outcome, OUTCOME.PROCESSED);
  assert.equal(saved.matchedMessages[0].processedCount, 1);
  assert.equal(saved.matchedMessages[0].canSaveAttachments, false);
});

test('повторный аудит дубля не заменяет успешный результат сохранённого письма', () => {
  const result = aggregateStatistics({
    auditLogs: [{
      messageId: 43,
      timestamp: 2,
      status: 'Пропущено как дубль',
      reason: 'Вложение уже сохранено'
    }],
    attachmentLogs: [{
      messageId: 43,
      timestamp: 1,
      partName: '1.2',
      ruleName: 'PDF',
      status: 'success',
      fileExists: true
    }]
  });

  assert.equal(result.matchedMessages[0].outcome, OUTCOME.PROCESSED);
  assert.equal(result.matchedMessages[0].outcomeLabel, 'Обработано');
  assert.equal(result.matchedMessages[0].reason, 'Вложения этого письма уже сохранены');
  assert.equal(result.matchedMessages[0].canSaveAttachments, false);
});

test('для предотвращённого дубля из другого письма действие сохранения недоступно', () => {
  const result = aggregateStatistics({
    auditLogs: [{
      messageId: 44,
      timestamp: 2,
      status: 'Пропущено как дубль'
    }],
    attachmentLogs: [{
      messageId: 44,
      timestamp: 1,
      partName: '1.2',
      ruleName: 'PDF',
      status: 'duplicate'
    }]
  });

  assert.equal(result.matchedMessages[0].outcome, OUTCOME.DUPLICATE);
  assert.equal(result.matchedMessages[0].canSaveAttachments, false);
});

test('каждый фильтр и их комбинация применяются к одному набору писем', () => {
  const filterAudits = [
    {
      messageId: 101, timestamp: 1, status: 'Обработано',
      senderName: 'Иван', senderEmail: 'ivan@example.com',
      accountName: 'Рабочий', matchedRuleName: 'PDF',
      matchedRuleFolder: 'Счета', receivedDate: '10.07.2026',
      importance: 'high'
    },
    {
      messageId: 102, timestamp: 2, status: 'Ошибка',
      senderName: 'Анна', senderEmail: 'anna@example.com',
      accountName: 'Личный', matchedRuleName: 'DOC',
      matchedRuleFolder: 'Договоры', receivedDate: '11.07.2026',
      importance: 'low'
    }
  ];
  const cases = [
    [{ sender: 'ivan' }, [101]],
    [{ ruleName: 'DOC' }, [102]],
    [{ accountName: 'Рабочий' }, [101]],
    [{ status: OUTCOME.PROCESSED }, [101]],
    [{ status: 'attention' }, [102]],
    [{ importance: 'low' }, [102]],
    [{ dateFrom: '2026-07-11', dateTo: '2026-07-11' }, [102]],
    [{
      sender: 'anna',
      ruleName: 'DOC',
      accountName: 'Личный',
      status: 'attention',
      importance: 'low',
      dateFrom: '2026-07-11',
      dateTo: '2026-07-11'
    }, [102]]
  ];

  for (const [filters, expectedIds] of cases) {
    const result = aggregateStatistics({ auditLogs: filterAudits, filters });
    assert.deepEqual(
      result.matchedMessages.map(row => row.messageId),
      expectedIds,
      JSON.stringify(filters)
    );
  }
});

test('все доступные группировки сохраняют итоговое количество писем', () => {
  const messages = aggregateStatistics({
    auditLogs: [
      {
        messageId: 201, timestamp: 1, status: 'Обработано',
        senderEmail: 'one@example.com', accountName: 'Рабочий',
        matchedRuleName: 'PDF', matchedRuleFolder: 'Счета',
        receivedDate: '10.07.2026', importance: 'high'
      },
      {
        messageId: 202, timestamp: 2, status: 'Ошибка',
        senderEmail: 'two@example.com', accountName: 'Личный',
        matchedRuleName: 'DOC', matchedRuleFolder: 'Договоры',
        receivedDate: '11.07.2026', importance: 'low'
      }
    ]
  }).matchedMessages;
  const keys = [
    'accountName',
    'sender',
    'ruleFolder',
    'ruleName',
    'eventDate',
    'importance',
    'outcome'
  ];

  for (const primary of keys) {
    const grouped = groupStatisticsMessages(messages, primary, '');
    assert.equal(grouped.reduce((sum, row) => sum + row.count, 0), 2, primary);
  }
  for (const secondary of keys) {
    const grouped = groupStatisticsMessages(messages, 'accountName', secondary);
    assert.equal(grouped.reduce((sum, row) => sum + row.count, 0), 2, secondary);
  }
  assert.deepEqual(groupStatisticsMessages(messages, '', ''), []);
});

test('быстрый фильтр внимания объединяет ошибки и частичную обработку', () => {
  const result = aggregateStatistics({
    auditLogs: [...audits, { messageId: 5, timestamp: 6, status: 'Ошибка', checkedDate: '05.07.2026' }],
    attachmentLogs: attachments,
    filters: { status: 'attention' }
  });
  assert.equal(result.messages.length, 2);
  assert.equal(result.kpi.attention, 2);
});

test('не считает служебный аудит письмом и распознаёт письмо без вложений по причине', () => {
  const result = aggregateStatistics({
    auditLogs: [
      {
        messageId: '',
        timestamp: 1,
        status: 'Проверено',
        reason: 'Стартовая проверка: найдено 3'
      },
      {
        messageId: 10,
        timestamp: 2,
        status: 'Совпало правило',
        reason: 'Письмо без вложений учтено в статистике по правилу',
        subject: 'Уведомление'
      }
    ]
  });

  assert.equal(result.kpi.matchedMessages, 1);
  assert.equal(result.kpi.noAttachments, 1);
});
