import * as StorageManager from '../modules/storageManager.mjs';
import { getAttachmentLogs, getMessageAuditLogs } from '../modules/statisticsManager.mjs';
import {
  aggregateStatistics,
  groupStatisticsMessages,
  OUTCOME,
  OUTCOME_LABELS
} from '../modules/statisticsAggregator.mjs';
import { multiSheetXlsxBlob } from '../modules/xlsx.mjs';
import { hydrateMessageHeaderIds, messageReportRows } from '../modules/messageReport.mjs';
import { groupAttachmentRows, paginate } from '../modules/pagination.mjs';
import { currentRuleNames } from '../modules/currentRuleNames.mjs';

const $ = id => document.getElementById(id);
const senderFilter = $('senderFilter');
const ruleNameFilter = $('ruleNameFilter');
const accountFilter = $('accountFilter');
const statusFilter = $('statusFilter');
const importanceFilter = $('importanceFilter');
const dateFromFilter = $('dateFromFilter');
const dateToFilter = $('dateToFilter');
const group1 = $('group1');
const group2 = $('group2');
const summaryBody = document.querySelector('#summaryTable tbody');
const messagesBody = document.querySelector('#messagesTable tbody');
const detailBody = document.querySelector('#statsTable tbody');
const messagesPageSize = $('messagesPageSize');
const attachmentsPageSize = $('attachmentsPageSize');

let allAttachmentLogs = [];
let allAuditLogs = [];
let currentModel = aggregateStatistics();
let autoRefreshTimer = null;
let isLoading = false;
let statisticsVersion = 0;
let loadedVersion = -1;
let viewedMessages = new Set();
let messageSort = { key: 'receivedDate', direction: 'desc' };
let messagesPage = 1;
let attachmentsPage = 1;
const savingMessageIds = new Set();
const completedSaveMessageIds = new Set();
let savingAll = false;
const messageHeaders = [...document.querySelectorAll('#messagesTable th[data-sort-key]')];

function updatePager(prefix, pageData, itemLabel) {
  $(`${prefix}PageInfo`).textContent = pageData.totalItems
    ? `${pageData.startIndex + 1}–${pageData.endIndex} из ${pageData.totalItems} ${itemLabel} · страница ${pageData.page} из ${pageData.totalPages}`
    : `0 ${itemLabel}`;
  $(`${prefix}PrevPage`).disabled = !pageData.hasPrevious;
  $(`${prefix}NextPage`).disabled = !pageData.hasNext;
}

function resetPagination() {
  messagesPage = 1;
  attachmentsPage = 1;
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function senderText(row) {
  const name = String(row.senderName || '').trim();
  const email = String(row.senderEmail || '').trim();
  if (name && email) return `${name} <${email}>`;
  return email || name || String(row.sender || '');
}

function senderCell(row) {
  const name = String(row.senderName || '').trim();
  const email = String(row.senderEmail || '').trim();
  if (!email) return esc(name || row.sender || '');
  const nameHtml = name ? `<div>${esc(name)}</div>` : '';
  return `${nameHtml}<a href="#" data-compose="${esc(email)}" title="Написать письмо">${esc(email)}</a>`;
}

function formatBytes(bytes) {
  const value = Math.max(0, Number(bytes || 0));
  if (value < 1024) return `${value} Б`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} КБ`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(2)} МБ`;
  return `${(value / 1024 ** 3).toFixed(2)} ГБ`;
}

function filters() {
  return {
    sender: senderFilter?.value || '',
    ruleName: ruleNameFilter?.value || '',
    accountName: accountFilter?.value || '',
    status: statusFilter?.value || '',
    importance: importanceFilter?.value || '',
    dateFrom: dateFromFilter?.value || '',
    dateTo: dateToFilter?.value || ''
  };
}

function setSelectOptions(select, placeholder, values) {
  if (!select) return;
  const current = select.value;
  select.replaceChildren();
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = placeholder;
  select.appendChild(empty);
  for (const value of values) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  }
  if (values.includes(current)) select.value = current;
}

function refreshModel() {
  currentModel = aggregateStatistics({
    auditLogs: allAuditLogs,
    attachmentLogs: allAttachmentLogs,
    filters: filters()
  });
  return currentModel;
}

function updateKpi(kpi) {
  $('kpiTotal').textContent = kpi.matchedMessages;
  $('kpiOk').textContent = kpi.processedMessages;
  $('kpiSaved').textContent = kpi.savedAttachments;
  $('kpiErr').textContent = kpi.attention;
  $('kpiDuplicates').textContent = kpi.duplicates;
  $('kpiRate').textContent = kpi.successRate === null ? '—' : String(kpi.successRate);
  $('kpiVolume').textContent = formatBytes(kpi.savedBytes);
  $('kpiSenders').textContent = kpi.uniqueSenders;
}

function groupLabel(row, key) {
  if (!key) return '';
  if (key === 'sender') return senderText(row) || 'Не указан';
  if (key === 'outcome') return row.outcomeLabel || OUTCOME_LABELS[row.outcome] || 'Неизвестно';
  if (key === 'importance') return importanceLabel(row.importance);
  if (key === 'ruleName') return row.ruleName || 'Без имени правила';
  if (key === 'ruleFolder') return row.ruleFolder || 'Не указана';
  if (key === 'eventDate') return row.eventDate || 'Дата не указана';
  return String(row[key] || '—');
}

function importanceLabel(value) {
  return ({
    high: 'Высокая',
    normal: 'Обычная',
    low: 'Низкая',
    unknown: 'Не определена'
  })[String(value || 'unknown').toLowerCase()] || 'Не определена';
}

function importanceMark(value) {
  const importance = String(value || 'unknown').toLowerCase();
  if (importance === 'high') {
    return '<span class="importance-mark importance-high" title="Высокая важность" aria-label="Высокая важность">!</span>';
  }
  if (importance === 'low') {
    return '<span class="importance-mark importance-low" title="Низкая важность" aria-label="Низкая важность">↓</span>';
  }
  if (importance === 'normal') {
    return '<span class="importance-mark importance-normal" title="Обычная важность" aria-label="Обычная важность">•</span>';
  }
  return '<span class="muted" title="Важность не определена">—</span>';
}

function messageSortValue(row, key) {
  if (key === 'receivedDate') {
    const iso = dateToComparable(row.receivedDate);
    return `${iso} ${String(row.receivedTime || '').padStart(8, '0')}`;
  }
  if (key === 'sender') return senderText(row).toLowerCase();
  if (key === 'importance') {
    return ({ high: 3, normal: 2, low: 1, unknown: 0 })[String(row.importance || 'unknown')] || 0;
  }
  if (key === 'outcome') return String(row.outcomeLabel || '');
  if (key === 'processedCount') return Number(row.processedCount || 0);
  return String(row[key] || '').toLowerCase();
}

function dateToComparable(value) {
  const text = String(value || '');
  const match = text.match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/);
  if (!match) return text;
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${year}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
}

function sortedMessages(messages) {
  return [...messages].sort((left, right) => {
    const a = messageSortValue(left, messageSort.key);
    const b = messageSortValue(right, messageSort.key);
    const result = typeof a === 'number' && typeof b === 'number'
      ? a - b
      : String(a).localeCompare(String(b), 'ru', { numeric: true, sensitivity: 'base' });
    return messageSort.direction === 'asc' ? result : -result;
  });
}

function updateMessageSortIndicators() {
  for (const header of messageHeaders) {
    header.classList.remove('sort-asc', 'sort-desc');
    header.setAttribute('aria-sort', 'none');
    if (header.dataset.sortKey === messageSort.key) {
      header.classList.add(messageSort.direction === 'asc' ? 'sort-asc' : 'sort-desc');
      header.setAttribute('aria-sort', messageSort.direction === 'asc' ? 'ascending' : 'descending');
    }
  }
}

function renderSummary(messages) {
  const first = group1?.value || '';
  const second = group2?.value || '';
  if (!first && !second) {
    summaryBody.innerHTML = '<tr><td colspan="3" class="empty">Выберите хотя бы одну группировку</td></tr>';
    return;
  }
  const rows = groupStatisticsMessages(messages, first, second);
  summaryBody.innerHTML = rows.length
    ? rows.map(row => `<tr><td>${esc(row.first)}</td><td>${esc(row.second)}</td><td>${row.count}</td></tr>`).join('')
    : '<tr><td colspan="3" class="empty">Нет данных</td></tr>';
}

function outcomeBadge(row) {
  const statusClass = row.outcome === OUTCOME.PROCESSED ? 'status-ok'
    : [OUTCOME.ERROR, OUTCOME.PARTIAL].includes(row.outcome) ? 'status-err'
      : row.outcome === OUTCOME.DUPLICATE ? 'status-warn' : 'status-neutral';
  return `<span class="status-badge ${statusClass}">${esc(row.outcomeLabel || OUTCOME_LABELS[row.outcome])}</span>`;
}

function matchedAttachmentsCell(row) {
  const attachments = Array.isArray(row.matchedAttachments) ? row.matchedAttachments : [];
  if (!attachments.length) return '<span class="muted">—</span>';
  const labels = {
    pending: 'ожидает',
    success: 'сохранено',
    duplicate: 'дубль',
    error: 'ошибка'
  };
  return attachments.map(attachment =>
    `<div class="matched-attachment-item">${esc(attachment.name)}<span class="muted"> · ` +
    `${esc(labels[attachment.status] || attachment.status || 'найдено')}</span></div>`
  ).join('');
}

function matchedRulesCell(row) {
  const rules = Array.isArray(row.matchedRules) ? row.matchedRules : [];
  if (!rules.length) return esc(row.ruleName || '—');
  return rules.map(rule => {
    const title = rule.name || rule.query || rule.folder || 'Без имени правила';
    const detail = rule.name && rule.folder
      ? `<span class="muted"> · ${esc(rule.folder)}</span>`
      : '';
    return `<div class="matched-rule-item">${esc(title)}${detail}</div>`;
  }).join('');
}

function renderMessages(messages) {
  messages = sortedMessages(messages);
  const pageData = paginate(messages, messagesPage, messagesPageSize.value);
  messagesPage = pageData.page;
  messages = pageData.items;
  updatePager('messages', pageData, 'писем');
  updateMessageSortIndicators();
  if (!messages.length) {
    messagesBody.innerHTML = '<tr><td colspan="12" class="empty">Нет результатов обработки</td></tr>';
    return;
  }
  messagesBody.innerHTML = messages.map((row, index) => {
    const key = row.messageId ? `mid:${row.messageId}` : '';
    const subject = row.messageId
      ? `<a href="#" data-message="${index}">${esc(row.subject || 'Без темы')}</a>`
      : esc(row.subject || 'Без темы');
    const messageKey = String(row.messageId || '');
    const isSaving = messageKey && savingMessageIds.has(messageKey);
    const isCompleted = messageKey && completedSaveMessageIds.has(messageKey);
    const saveAction = row.messageId &&
      row.outcome !== OUTCOME.NO_ATTACHMENTS &&
      row.canSaveAttachments !== false &&
      !isCompleted
      ? `<button type="button" data-save-message="${index}" class="primary"${isSaving ? ' disabled aria-busy="true"' : ''}>${isSaving ? 'Сохранение…' : 'Сохранить вложения'}</button>`
      : '—';
    return `<tr class="${key && !viewedMessages.has(key) ? 'new-row' : ''}" data-message-key="${esc(key)}">
      <td>${pageData.startIndex + index + 1}</td>
      <td>${esc(row.receivedDate || row.checkedDate || '')}<div class="muted">${esc(row.receivedTime || '')}</div></td>
      <td>${esc(row.accountName || '')}</td>
      <td>${senderCell(row)}</td>
      <td>${subject}</td>
      <td>${matchedAttachmentsCell(row)}</td>
      <td>${saveAction}</td>
      <td>${importanceMark(row.importance)}</td>
      <td>${matchedRulesCell(row)}</td>
      <td>${outcomeBadge(row)}</td>
      <td>${esc(row.reason || '—')}</td>
      <td>${Number(row.processedCount || 0)}</td>
    </tr>`;
  }).join('');

  messagesBody.querySelectorAll('tr.new-row[data-message-key]').forEach(row => {
    row.addEventListener('mouseenter', async () => {
      const key = row.dataset.messageKey;
      if (!key || viewedMessages.has(key)) return;
      viewedMessages.add(key);
      row.classList.remove('new-row');
      await StorageManager.update(
        'viewedMessages',
        current => [...new Set([
          ...(Array.isArray(current) ? current : []),
          key
        ])],
        []
      );
    }, { once: true });
  });

  messagesBody.onclick = async event => {
    const saveButton = event.target.closest('button[data-save-message]');
    if (saveButton) {
      event.preventDefault();
      const row = messages[Number(saveButton.dataset.saveMessage)];
      if (!row || !row.messageId) return;
      const messageKey = String(row.messageId);
      if (savingMessageIds.has(messageKey)) return;
      savingMessageIds.add(messageKey);
      saveButton.disabled = true;
      saveButton.setAttribute('aria-busy', 'true');
      saveButton.textContent = 'Сохранение…';
      try {
        let result = await messenger.runtime.sendMessage({
          type: 'saveMessageAttachments',
          messageId: row.messageId
        });
        const duplicateSources = Array.isArray(result && result.duplicateSources)
          ? result.duplicateSources
          : [];
        if (duplicateSources.length) {
          const details = duplicateSources.map(source => {
            const letter = source.subject ? `«${source.subject}»` : `ID ${source.messageId || 'не указан'}`;
            const date = source.receivedDate ? ` от ${source.receivedDate}` : '';
            const sender = source.senderEmail ? `, отправитель ${source.senderEmail}` : '';
            const attachment = source.attachmentName ? ` — ${source.attachmentName}` : '';
            return `${letter}${date}${sender}${attachment}`;
          });
          alert(`Вложение уже было сохранено из письма:\n${details.join('\n')}`);
        }
        if (['Обработано', 'Пропущено как дубль'].includes(String(result && result.auditStatus || ''))) {
          completedSaveMessageIds.add(messageKey);
        }
        savingMessageIds.delete(messageKey);
        await load();
        $('lastUpdated').textContent = Number(result && result.saved || 0) > 0
          ? `Сохранено вложений: ${Number(result.saved)}`
          : Number(result && result.alreadySaved || 0) > 0
            ? `Вложение уже сохранено для этого письма и восстановлено в статистике`
            : `Новых вложений не сохранено: ${String(result && result.reason || 'проверьте результат')}`;
      } catch (error) {
        savingMessageIds.delete(messageKey);
        $('lastUpdated').textContent = `Ошибка сохранения: ${String(error)}`;
        saveButton.disabled = false;
        saveButton.removeAttribute('aria-busy');
        saveButton.textContent = 'Сохранить вложения';
      }
      return;
    }
    const composeLink = event.target.closest('a[data-compose]');
    if (composeLink) {
      event.preventDefault();
      await messenger.runtime.sendMessage({ type: 'composeNew', to: composeLink.dataset.compose });
      return;
    }
    const link = event.target.closest('a[data-message]');
    if (!link) return;
    event.preventDefault();
    const row = messages[Number(link.dataset.message)];
    if (!row) return;
    await messenger.runtime.sendMessage({ type: 'openMessageById', messageId: row.messageId });
    const key = `mid:${row.messageId}`;
    viewedMessages.add(key);
    await StorageManager.update('viewedMessages', current => [...new Set([...(Array.isArray(current) ? current : []), key])], []);
    link.closest('tr')?.classList.remove('new-row');
  };
}

function eligibleForSave(row) {
  return Boolean(row.messageId) &&
    row.outcome !== OUTCOME.NO_ATTACHMENTS &&
    row.canSaveAttachments !== false &&
    !completedSaveMessageIds.has(String(row.messageId));
}

async function saveAllAttachments() {
  if (savingAll) return;
  const model = refreshModel();
  const targets = sortedMessages(model.matchedMessages).filter(eligibleForSave);
  if (!targets.length) {
    $('lastUpdated').textContent = 'Нет писем, ожидающих сохранения вложений';
    return;
  }
  if (!confirm(`Сохранить вложения для ${targets.length} писем (текущие фильтры и сортировка)? Это может занять некоторое время.`)) return;

  savingAll = true;
  const btn = $('saveAllBtn');
  btn.disabled = true;
  let totalSaved = 0;
  let duplicates = 0;
  let errors = 0;
  for (let i = 0; i < targets.length; i++) {
    const row = targets[i];
    const messageKey = String(row.messageId);
    if (savingMessageIds.has(messageKey)) continue;
    savingMessageIds.add(messageKey);
    btn.textContent = `Сохранение… ${i + 1} из ${targets.length}`;
    try {
      const result = await messenger.runtime.sendMessage({
        type: 'saveMessageAttachments',
        messageId: row.messageId
      });
      if (['Обработано', 'Пропущено как дубль'].includes(String(result && result.auditStatus || ''))) {
        completedSaveMessageIds.add(messageKey);
      }
      totalSaved += Number(result && result.saved || 0);
      if (Array.isArray(result && result.duplicateSources) && result.duplicateSources.length) duplicates += 1;
    } catch (error) {
      errors += 1;
    } finally {
      savingMessageIds.delete(messageKey);
    }
  }
  savingAll = false;
  btn.disabled = false;
  btn.textContent = 'Сохранить все вложения';
  await load();
  $('lastUpdated').textContent = `Массовое сохранение завершено: писем обработано ${targets.length}, сохранено вложений ${totalSaved}` +
    (duplicates ? `, пропущено как дубль ${duplicates}` : '') +
    (errors ? `, ошибок ${errors}` : '');
}

for (const header of messageHeaders) {
  header.addEventListener('click', () => {
    const key = header.dataset.sortKey;
    if (messageSort.key === key) {
      messageSort.direction = messageSort.direction === 'asc' ? 'desc' : 'asc';
    } else {
      messageSort = {
        key,
        direction: ['receivedDate', 'importance', 'processedCount'].includes(key) ? 'desc' : 'asc'
      };
    }
    messagesPage = 1;
    render();
  });
}

function attachmentStatus(row) {
  if (row.fileExists === false) return '<span class="status-badge status-err">Файл удалён</span>';
  if (row.status === 'success') return '<span class="status-badge status-ok">Скачано</span>';
  if (row.status === 'pending') return '<span class="status-badge status-neutral">Ожидает сохранения</span>';
  if (row.status === 'duplicate') return '<span class="status-badge status-warn">Дубль</span>';
  if (row.status === 'no_attachment') return '<span class="status-badge status-neutral">Нет вложения</span>';
  return '<span class="status-badge status-err">Ошибка</span>';
}

function renderAttachments(rows) {
  const allGroups = groupAttachmentRows(rows);
  const pageData = paginate(allGroups, attachmentsPage, attachmentsPageSize.value);
  attachmentsPage = pageData.page;
  const groups = pageData.items;
  updatePager('attachments', pageData, 'писем');
  if (!allGroups.length) {
    detailBody.innerHTML = '<tr><td colspan="12" class="empty">Нет вложений для выбранных фильтров</td></tr>';
    return;
  }

  detailBody.innerHTML = groups.map((items, groupIndex) => {
    const span = items.length;
    return items.map(({ row, index }, itemIndex) => {
      const first = itemIndex === 0;
      const file = row.fileExists !== false && (row.downloadId || row.fullPath)
        ? `<a href="#" data-file="${index}">${esc(row.attachmentName || row.savedAs || 'Файл')}</a>`
        : esc(row.attachmentName || row.savedAs || '—');
      const subject = row.messageId
        ? `<a href="#" data-attachment-message="${index}" title="Открыть исходное письмо">${esc(row.subject || 'Без темы')}</a>`
        : esc(row.subject || 'Без темы');
      const messageLink = row.messageId
        ? `<a href="#" data-attachment-message="${index}" title="Открыть исходное письмо">Открыть письмо</a>`
        : '—';
      const shared = first ? `
        <td rowspan="${span}">${pageData.startIndex + groupIndex + 1}</td>
        <td rowspan="${span}">${esc(row.receivedDate || row.date || '')}<div class="muted">${esc(row.receivedTime || row.time || '')}</div></td>
        <td rowspan="${span}">${esc(row.accountName || '')}</td>
        <td rowspan="${span}">${esc(senderText(row))}</td>
        <td rowspan="${span}">${subject}</td>` : '';
      const sharedTail = first ? `
        <td rowspan="${span}">${messageLink}</td>
        <td rowspan="${span}">${importanceMark(row.importance)}</td>` : '';
      const saved = first ? `<td rowspan="${span}">${span}</td>` : '';
      return `<tr class="${first ? 'attachment-group-start' : 'attachment-group-item'}">
        ${shared}
        <td>${file}<div class="muted">${esc(formatBytes(row.attachmentSize))}</div></td>
        ${sharedTail}
        <td>${esc(row.ruleName || row.ruleQuery || row.ruleFolder || '—')}</td>
        <td>${attachmentStatus(row)}</td>
        <td>Файл успешно сохранён на диск</td>
        ${saved}
      </tr>`;
    }).join('');
  }).join('');
  detailBody.onclick = async event => {
    const messageLink = event.target.closest('a[data-attachment-message]');
    if (messageLink) {
      event.preventDefault();
      const row = rows[Number(messageLink.dataset.attachmentMessage)];
      if (!row || !row.messageId) return;
      await StorageManager.appendToArray('detailLinkLog', {
        ts: Date.now(),
        side: 'statistics',
        type: 'message-click',
        messageId: row.messageId
      }, 300);
      await messenger.runtime.sendMessage({
        type: 'openMessageById',
        messageId: row.messageId
      });
      return;
    }
    const link = event.target.closest('a[data-file]');
    if (!link) return;
    event.preventDefault();
    const row = rows[Number(link.dataset.file)];
    if (!row) return;
    await StorageManager.appendToArray('detailLinkLog', { ts: Date.now(), side: 'statistics', type: 'file-click', messageId: row.messageId || '' }, 300);
    if (row.downloadId) await messenger.runtime.sendMessage({ type: 'openFileLocation', downloadId: row.downloadId });
    else if (row.fullPath) await messenger.runtime.sendMessage({ type: 'openDownload', fileUrl: `file://${String(row.fullPath).replace(/\\/g, '/')}` });
  };
}

function render() {
  const model = refreshModel();
  updateKpi(model.kpi);
  renderSummary(model.matchedMessages);
  renderMessages(model.matchedMessages);
  renderAttachments(model.attachments);
  messenger.storage.local.set({
    statisticsDiagnostics: {
      capturedAt: Date.now(),
      sourceCounts: {
        attachmentLogs: Array.isArray(allAttachmentLogs) ? allAttachmentLogs.length : 0,
        auditLogs: Array.isArray(allAuditLogs) ? allAuditLogs.length : 0
      },
      resultCounts: {
        messages: model.matchedMessages.length,
        attachments: model.attachments.length,
        attachmentGroups: new Set(
          model.attachments.map((row, index) => row.messageId ? `message:${row.messageId}` : `legacy:${index}`)
        ).size
      },
      filters: {
        senderActive: Boolean(senderFilter?.value),
        ruleActive: Boolean(ruleNameFilter?.value),
        accountActive: Boolean(accountFilter?.value),
        status: statusFilter?.value || '',
        importance: importanceFilter?.value || '',
        dateFromSet: Boolean(dateFromFilter?.value),
        dateToSet: Boolean(dateToFilter?.value),
        group1: group1?.value || '',
        group2: group2?.value || ''
      },
      sort: { ...messageSort },
      highlightedMessageRows: messagesBody.querySelectorAll('tr.new-row').length
    }
  }).catch(() => {});
}

async function load(silent = false) {
  if (isLoading) return;
  isLoading = true;
  const versionAtStart = statisticsVersion;
  try {
    const [attachments, audits, viewed, rules] = await Promise.all([
      messenger.runtime.sendMessage({ type: 'getReconciledAttachmentLogs' })
        .catch(() => getAttachmentLogs()),
      getMessageAuditLogs(),
      StorageManager.get('viewedMessages', []),
      StorageManager.get('rules', [])
    ]);
    allAttachmentLogs = attachments;
    allAuditLogs = audits;
    viewedMessages = new Set(Array.isArray(viewed) ? viewed : []);
    const unfiltered = aggregateStatistics({ auditLogs: allAuditLogs, attachmentLogs: allAttachmentLogs });
    setSelectOptions(ruleNameFilter, 'Все правила', currentRuleNames(rules));
    setSelectOptions(accountFilter, 'Все ящики', unfiltered.options.accountNames);
    render();
    if (statisticsVersion === versionAtStart) loadedVersion = versionAtStart;
    $('lastUpdated').textContent = `Последнее обновление: ${new Date().toLocaleTimeString()}`;
  } catch (error) {
    if (!silent) $('lastUpdated').textContent = `Ошибка обновления: ${String(error)}`;
  } finally {
    isLoading = false;
  }
}

function startAutoRefresh() {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  autoRefreshTimer = null;
  const enabled = $('autoRefreshToggle').checked;
  $('liveState').innerHTML = enabled ? '<span class="live-dot"></span> При изменении данных' : 'Автообновление выключено';
  if (enabled) autoRefreshTimer = setInterval(() => {
    if (!document.hidden && !isLoading && loadedVersion !== statisticsVersion) load(true);
  }, 1000);
}

if (messenger.storage && messenger.storage.onChanged) {
  messenger.storage.onChanged.addListener(changes => {
    if (changes.attachmentLogs || changes.messageAuditLogs || changes.viewedMessages || changes.rules) {
      statisticsVersion += 1;
    }
  });
}

function resetFilters() {
  for (const element of [senderFilter, ruleNameFilter, accountFilter, statusFilter, importanceFilter, dateFromFilter, dateToFilter, group1, group2]) {
    if (element) element.value = '';
  }
  resetPagination();
  render();
}

function isoNow() {
  return new Date().toISOString();
}

function filename(prefix) {
  const from = dateFromFilter.value;
  const to = dateToFilter.value;
  return `${prefix}_${from && to ? `${from}_${to}` : from || to || new Date().toISOString().slice(0, 10)}.xlsx`;
}

function kpiRows(kpi) {
  return [
    { Показатель: 'Писем по правилам', Значение: kpi.matchedMessages },
    { Показатель: 'Обработано писем', Значение: kpi.processedMessages },
    { Показатель: 'Сохранено вложений', Значение: kpi.savedAttachments },
    { Показатель: 'Требуют внимания', Значение: kpi.attention },
    { Показатель: 'Дубли', Значение: kpi.duplicates },
    { Показатель: 'Нет вложений', Значение: kpi.noAttachments },
    { Показатель: 'Уникальных отправителей', Значение: kpi.uniqueSenders },
    { Показатель: 'Успешность сохранения, %', Значение: kpi.successRate ?? '' },
    { Показатель: 'Объём сохранённых файлов, байт', Значение: kpi.savedBytes }
  ];
}

async function downloadWorkbook(blob, outputName) {
  const url = URL.createObjectURL(blob);
  try {
    await messenger.downloads.download({ url, filename: outputName, saveAs: true, conflictAction: 'uniquify' });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function exportXlsx() {
  const model = refreshModel();
  const messages = await hydrateMessageHeaderIds(
    model.matchedMessages,
    messenger.messages && messenger.messages.get
      ? messageId => messenger.messages.get(messageId)
      : null
  );
  const blob = multiSheetXlsxBlob([
    { name: 'Письма', rows: messageReportRows(messages) }
  ]);
  await downloadWorkbook(blob, filename('Статистика'));
}

function topRows(rows, getter, label) {
  const counts = new Map();
  for (const row of rows) {
    const key = getter(row) || 'Не указано';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count]) => ({ [label]: name, Писем: count }));
}

async function exportManagerXlsx() {
  const model = refreshModel();
  const blob = multiSheetXlsxBlob([
    { name: 'KPI', rows: kpiRows(model.kpi) },
    { name: 'Топ правил', rows: topRows(model.matchedMessages, row => row.ruleName, 'Правило') },
    { name: 'Топ отправителей', rows: topRows(model.matchedMessages, senderText, 'Отправитель') },
    { name: 'Параметры', rows: [{ exported_at: isoNow(), ...filters() }] }
  ]);
  await downloadWorkbook(blob, filename('Отчет_руководителя'));
}

$('refreshBtn').addEventListener('click', () => load());
$('resetFiltersBtn').addEventListener('click', resetFilters);
$('saveAllBtn').addEventListener('click', saveAllAttachments);
$('exportBtn').addEventListener('click', exportXlsx);
$('exportManagerBtn').addEventListener('click', exportManagerXlsx);
for (const element of [senderFilter, ruleNameFilter, accountFilter, statusFilter, importanceFilter, dateFromFilter, dateToFilter, group1, group2]) {
  element.addEventListener(element === senderFilter ? 'input' : 'change', () => {
    resetPagination();
    render();
  });
}
messagesPageSize.addEventListener('change', () => {
  messagesPage = 1;
  render();
});
attachmentsPageSize.addEventListener('change', () => {
  attachmentsPage = 1;
  render();
});
$('messagesPrevPage').addEventListener('click', () => {
  messagesPage -= 1;
  render();
  $('messagesTable').scrollIntoView({ block: 'start' });
});
$('messagesNextPage').addEventListener('click', () => {
  messagesPage += 1;
  render();
  $('messagesTable').scrollIntoView({ block: 'start' });
});
$('attachmentsPrevPage').addEventListener('click', () => {
  attachmentsPage -= 1;
  render();
  $('statsTable').scrollIntoView({ block: 'start' });
});
$('attachmentsNextPage').addEventListener('click', () => {
  attachmentsPage += 1;
  render();
  $('statsTable').scrollIntoView({ block: 'start' });
});
$('autoRefreshToggle').addEventListener('change', startAutoRefresh);
document.querySelectorAll('.card[data-status]').forEach(card => {
  card.addEventListener('click', () => {
    statusFilter.value = card.dataset.status || '';
    resetPagination();
    render();
    $('messagesTable').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});
window.addEventListener('DOMContentLoaded', async () => {
  await load();
  startAutoRefresh();
});
window.addEventListener('unload', () => {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
});
