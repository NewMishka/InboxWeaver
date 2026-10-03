import { parseRuleFile, ruleFileJson } from '../modules/ruleFile.mjs';

let editingIndex = -1;
let cachedAccounts = [];
let cachedFolders = [];

function setFormMessage(message = '', type = '') {
  const el = document.getElementById('formMessage');
  el.textContent = message;
  el.className = `form-message${type ? ` ${type}` : ''}`;
}

function setRuleFileStatus(message = '', type = '') {
  const el = document.getElementById('ruleFileStatus');
  el.textContent = message;
  el.className = `muted${type ? ` ${type}` : ''}`;
}

function importedRuleId(index) {
  return `import-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`;
}

async function exportRulesFile() {
  const rules = (await StorageManager.get({ rules: [] })).rules || [];
  const url = URL.createObjectURL(new Blob([ruleFileJson(rules)], { type: 'application/json' }));
  try {
    await messenger.downloads.download({
      url,
      filename: `inbox-weaver-rules-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
      saveAs: true,
      conflictAction: 'uniquify'
    });
    setRuleFileStatus(`Сохранено правил: ${rules.length}. Файл можно редактировать в текстовом редакторе.`, 'success');
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function importRulesFile(file) {
  if (!file) return;
  const importButton = document.getElementById('importRulesFile');
  importButton.disabled = true;
  setRuleFileStatus('Проверяем файл правил...');
  try {
    const imported = parseRuleFile(await file.text(), importedRuleId);
    const validation = await messenger.runtime.sendMessage({ type: 'validateRuleDefinitions', rules: imported });
    if (!validation || validation.invalid) {
      const errors = (validation?.rules || [])
        .filter(rule => !rule.valid)
        .map(rule => `«${rule.name}»: ${(rule.errors || []).join('; ')}`)
        .join(' · ');
      throw new Error(`правила не сохранены. ${errors || 'Не удалось проверить правила.'}`);
    }
    const current = (await StorageManager.get({ rules: [] })).rules || [];
    const mode = document.getElementById('ruleImportMode').value;
    const next = mode === 'append' ? [...current, ...imported] : imported;
    const action = mode === 'append' ? 'добавить' : 'заменить';
    if (!confirm(`${action[0].toUpperCase()}${action.slice(1)} ${current.length} правил(а) ${imported.length} правил(а) из файла?`)) {
      setRuleFileStatus('Загрузка отменена.');
      return;
    }
    await StorageManager.set({ rules: next });
    await renderRules();
    resetForm();
    setRuleFileStatus(`Загружено правил: ${imported.length}.`, 'success');
  } catch (error) {
    setRuleFileStatus(`Ошибка загрузки: ${String(error && error.message || error)}`, 'error');
  } finally {
    importButton.disabled = false;
    document.getElementById('ruleFileInput').value = '';
  }
}

function updateSelectionSummary() {
  const accounts = selectedAccountIds();
  const folders = selectedFolderKeys();
  const el = document.getElementById('selectionSummary');
  if (!accounts.length) {
    el.textContent = 'Выберите хотя бы один почтовый ящик';
    return;
  }
  el.textContent = `Выбрано ящиков: ${accounts.length} · папок: ${folders.length}`;
}

function updateQueryPreview() {
  const query = document.getElementById('query').value.trim();
  const preview = document.getElementById('queryPreview');
  preview.textContent = query || 'Условие пока не задано';
  preview.classList.toggle('empty', !query);
}

function setEditorMode(editing, ruleName = '') {
  document.getElementById('editorTitle').textContent = editing ? 'Редактирование правила' : 'Новое правило';
  document.getElementById('editorSubtitle').textContent = editing
    ? `Измените параметры${ruleName ? ` правила «${ruleName}»` : ''} и сохраните.`
    : 'Настройте, какие письма искать и куда сохранять вложения.';
  document.getElementById('editorMode').textContent = editing ? 'Редактирование' : 'Создание';
}

function sanitizeRelativePath(v) {
  return String(v || '')
    .replace(/^([A-Za-z]:)?[\\/]+/, '')
    .replace(/\.\.+/g, '')
    .replace(/[<>:"|?*\x00-\x1F]/g, '_')
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');
}

function selectedAccountIds() {
  return [...document.querySelectorAll('#accounts input:checked')].map(x => String(x.value));
}

function selectedFolderKeys() {
  return [...document.querySelectorAll('#foldersScope input[data-role="folder"]:checked')].map(x => String(x.value));
}

function selectedFolderObjects() {
  const keys = selectedFolderKeys();
  return keys.map(key => cachedFolders.find(x => x.key === key)).filter(Boolean).map(item => ({
    key: item.key,
    accountId: String(item.accountId),
    path: item.path || '',
    displayPath: item.displayPath || ''
  }));
}

function queryFromBuilder() {
  const field = document.getElementById('fieldSelect').value;
  const operator = document.getElementById('operatorSelect').value;
  const value = document.getElementById('valueInput').value.trim();
  if (!value) return '';
  const normalized = operator === 'exact' ? `"${value}"` : value;
  if (operator === 'not_contains') return `-${field}:${normalized}`;
  return `${field}:${normalized}`;
}

function fillBuilderFromQuery(query) {
  const q = (query || '').trim();
  const m = q.match(/^(-)?(subject|body|from|fileext):(?:"([^"]+)"|(.+))$/i);
  if (!m) return;
  document.getElementById('fieldSelect').value = (m[2] || 'subject').toLowerCase();
  document.getElementById('operatorSelect').value = m[1] ? 'not_contains' : (m[3] ? 'exact' : 'contains');
  document.getElementById('valueInput').value = (m[3] || m[4] || '').trim();
}

function renderAccounts(selected = []) {
  const wrap = document.getElementById('accounts');
  if (!cachedAccounts.length) {
    wrap.innerHTML = '<div class="muted">Ящики не найдены</div>';
    return;
  }
  wrap.innerHTML = '';
  cachedAccounts.forEach(acc => {
    const id = String(acc.id);
    const label = document.createElement('label');
    label.className = 'acc-item';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = id;
    input.checked = selected.map(String).includes(id);
    const text = document.createElement('span');
    text.textContent = acc.name || id;
    label.append(input, text);
    wrap.appendChild(label);
  });
  wrap.querySelectorAll('input').forEach(input => input.addEventListener('change', () => {
    const selectedFolders = selectedFolderKeys();
    renderFolderScope({ folderKeys: selectedFolders });
    updateSelectionSummary();
  }));
  updateSelectionSummary();
}

function getAccountName(id) {
  const acc = cachedAccounts.find(a => String(a.id) === String(id));
  return acc ? (acc.name || acc.id) : String(id);
}

function renderFolderScope(rule = null) {
  const wrap = document.getElementById('foldersScope');
  const accountIds = selectedAccountIds();
  if (!accountIds.length) {
    wrap.innerHTML = '<div class="empty-state">Сначала выберите почтовый ящик</div>';
    updateSelectionSummary();
    return;
  }
  const selectedFolderSet = new Set((rule && rule.folderKeys || []).map(String));
  wrap.innerHTML = '';
  accountIds.forEach(accountId => {
    const group = document.createElement('div');
    group.className = 'check-group';
    const accountName = getAccountName(accountId);
    const folders = cachedFolders.filter(f => String(f.accountId) === String(accountId));
    const title = document.createElement('div');
    title.className = 'check-group-title';
    title.textContent = accountName;
    const subtitle = document.createElement('div');
    subtitle.className = 'check-subtitle';
    subtitle.textContent = folders.length ? 'Выберите папки' : 'Папки не найдены';
    group.append(title, subtitle);
    const folderList = document.createElement('div');
    folderList.className = 'folder-list';
    folders.forEach(folder => {
      const row = document.createElement('label');
      row.className = 'check-row';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.dataset.role = 'folder';
      input.dataset.accountId = accountId;
      input.value = folder.key;
      input.checked = selectedFolderSet.has(String(folder.key));
      input.addEventListener('change', updateSelectionSummary);
      const text = document.createElement('span');
      text.textContent = folder.displayPath || folder.path;
      row.append(input, text);
      folderList.appendChild(row);
    });
    group.appendChild(folderList);
    wrap.appendChild(group);
  });
  updateSelectionSummary();
}

function accountLabel(rule) {
  if (!rule.accountIds || !rule.accountIds.length) return '—';
  return rule.accountIds.map(id => getAccountName(id)).join(', ');
}

function folderLabel(rule) {
  const folderKeys = Array.isArray(rule.folderKeys) ? rule.folderKeys.map(String) : [];
  const parts = [];
  folderKeys.forEach(key => {
    const item = cachedFolders.find(f => String(f.key) === String(key));
    if (item) parts.push(`«${getAccountName(item.accountId)}»: ${item.displayPath || item.path}`);
  });
  return parts.length ? parts.join(', ') : '—';
}

function saveModeLabel(v) {
  return ({ combined: 'Общий', by_rule: 'По правилу', by_sender: 'По отправителю', by_account: 'По ящику', by_date: 'По дате' })[v] || v;
}

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

async function loadSources(selectedAccounts = [], selectedFolders = []) {
  document.getElementById('accounts').innerHTML = 'Загрузка...';
  try { cachedAccounts = await messenger.runtime.sendMessage({ type: 'getAccounts' }) || []; } catch (e) { cachedAccounts = []; }
  try { cachedFolders = await messenger.runtime.sendMessage({ type: 'getFolders' }) || []; } catch (e) { cachedFolders = []; }
  renderAccounts(selectedAccounts);
  renderFolderScope({ folderKeys: selectedFolders });
}


function resetForm() {
  editingIndex = -1;
  document.getElementById('ruleName').value = '';
  document.getElementById('query').value = '';
  document.getElementById('folder').value = '';
  document.getElementById('ruleBasePath').value = '';
  document.getElementById('saveMode').value = 'combined';
  document.getElementById('fieldSelect').value = 'subject';
  document.getElementById('operatorSelect').value = 'contains';
  document.getElementById('valueInput').value = '';
  renderAccounts([]);
  renderFolderScope();
  document.getElementById('addRule').style.display = '';
  document.getElementById('saveEdit').style.display = 'none';
  document.getElementById('cancelEdit').style.display = 'none';
  setEditorMode(false);
  setFormMessage('');
  updateQueryPreview();
}

async function collectRuleForm(existing = {}) {
  const name = document.getElementById('ruleName').value.trim();
  let q = document.getElementById('query').value.trim();
  if (!q) q = queryFromBuilder();
  if (!name) {
    setFormMessage('Укажите понятное название правила.', 'error');
    document.getElementById('ruleName').focus();
    return null;
  }
  if (!q) {
    setFormMessage('Соберите хотя бы одно условие.', 'error');
    document.getElementById('valueInput').focus();
    return null;
  }
  const folder = sanitizeRelativePath(document.getElementById('folder').value.trim());
  if (!folder) {
    setFormMessage('Укажите папку, куда сохранять вложения.', 'error');
    document.getElementById('folder').focus();
    return null;
  }
  const accountIds = selectedAccountIds();
  if (!accountIds.length) {
    setFormMessage('Выберите хотя бы один почтовый ящик.', 'error');
    document.getElementById('accounts').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return null;
  }
  const folderKeys = selectedFolderKeys();
  if (!folderKeys.length) {
    setFormMessage('Выберите хотя бы одну папку для сканирования.', 'error');
    document.getElementById('foldersScope').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return null;
  }
  setFormMessage('');
  return {
    ...existing,
    id: existing.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    query: q,
    queryLabel: q,
    folder,
    basePath: sanitizeRelativePath(document.getElementById('ruleBasePath').value.trim()),
    saveMode: document.getElementById('saveMode').value || 'combined',
    accountIds,
    folderKeys,
    folderObjects: selectedFolderObjects(),
    enabled: existing.enabled !== false
  };
}

function fillTestResults(res) {
  const wrap = document.getElementById('testResults');
  const rules = (res && res.rules) || [];
  if (!rules.length) {
    wrap.innerHTML = '<div class="empty-state">Нет сохранённых правил для проверки.</div>';
    return;
  }
  wrap.innerHTML = rules.map(rule => {
    const issues = [
      ...(rule.errors || []).map(text => `<div class="validation-error">Ошибка: ${esc(text)}</div>`),
      ...(rule.warnings || []).map(text => `<div class="validation-warning">Внимание: ${esc(text)}</div>`)
    ].join('');
    const state = rule.valid ? ((rule.warnings || []).length ? 'warning' : 'valid') : 'invalid';
    const label = state === 'valid' ? 'Готово' : state === 'warning' ? 'Есть замечания' : 'Нужно исправить';
    return `<div class="test-rule ${state}"><div class="rule-top"><b>${esc(rule.name)}</b><span class="state-badge ${state === 'valid' ? 'enabled' : 'disabled'}">${label}</span></div><div class="rule-query">${esc(rule.query || 'Условие не задано')}</div>${issues}</div>`;
  }).join('');
}

async function runRuleTest() {
  const btn = document.getElementById('testRulesBtn');
  const statusEl = document.getElementById('testStatus');
  btn.disabled = true;
  statusEl.textContent = 'Проверяем настройки правил...';
  try {
    const res = await messenger.runtime.sendMessage({ type: 'validateRules' });
    if (!res || res.error) {
      statusEl.textContent = 'Ошибка: ' + ((res && res.error) || 'нет ответа');
      document.getElementById('testResults').innerHTML = '';
    } else {
      statusEl.textContent = `Проверено: ${res.total || 0} · готово: ${res.valid || 0} · требуют исправления: ${res.invalid || 0}`;
      fillTestResults(res);
    }
  } catch (e) {
    statusEl.textContent = 'Ошибка проверки: ' + e;
  } finally {
    btn.disabled = false;
  }
}

async function renderRules() {
  const wrap = document.getElementById('rules');
  const rules = (await StorageManager.get({ rules: [] })).rules || [];
  document.getElementById('rulesCount').textContent = String(rules.length);
  if (!rules.length) {
    wrap.innerHTML = '<div class="empty-state">Правил пока нет.<br>Создайте первое правило по шагам слева.</div>';
    return;
  }
  wrap.innerHTML = rules.map((rule, idx) => `
    <div class="rule ${rule.enabled === false ? 'rule-disabled' : ''}">
      <div class="rule-top">
        <div><span class="badge">#${idx + 1}</span><div class="rule-title">${esc(rule.name || 'Без названия')}</div></div>
        <span class="state-badge ${rule.enabled === false ? 'disabled' : 'enabled'}">${rule.enabled === false ? 'Выключено' : 'Активно'}</span>
      </div>
      <div class="rule-query">${esc(rule.query || '')}</div>
      <div class="rule-summary">
        <div><b>Ищет:</b> ${esc(folderLabel(rule))}</div>
        <div><b>Сохраняет:</b> ${esc(rule.folder || '')}${rule.basePath ? ` / ${esc(rule.basePath)}` : ''}</div>
        <div><b>Структура:</b> ${esc(saveModeLabel(rule.saveMode || 'combined'))}</div>
      </div>
      <div class="rule-actions">
        <button class="edit primary" data-idx="${idx}">Изменить</button>
        <button class="toggle" data-idx="${idx}">${rule.enabled === false ? 'Включить' : 'Выключить'}</button>
        <button class="up icon-action" data-idx="${idx}" title="Поднять выше" ${idx === 0 ? 'disabled' : ''}>↑</button>
        <button class="down icon-action" data-idx="${idx}" title="Опустить ниже" ${idx === rules.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="delete danger" data-idx="${idx}">Удалить</button>
      </div>
    </div>`).join('');

  wrap.querySelectorAll('.delete').forEach(btn => btn.addEventListener('click', async e => {
    const idx = Number(e.target.dataset.idx);
    const rules = (await StorageManager.get({ rules: [] })).rules;
    if (!confirm(`Удалить правило «${rules[idx] && rules[idx].name || 'Без названия'}»?`)) return;
    rules.splice(idx, 1);
    await StorageManager.set({ rules });
    await renderRules();
    if (editingIndex === idx) resetForm();
  }));

  wrap.querySelectorAll('.toggle').forEach(btn => btn.addEventListener('click', async e => {
    const idx = Number(e.target.dataset.idx);
    const rules = (await StorageManager.get({ rules: [] })).rules;
    rules[idx].enabled = !(rules[idx].enabled !== false);
    await StorageManager.set({ rules });
    await renderRules();
  }));

  wrap.querySelectorAll('.up').forEach(btn => btn.addEventListener('click', async e => {
    const idx = Number(e.target.dataset.idx);
    if (idx <= 0) return;
    const rules = (await StorageManager.get({ rules: [] })).rules;
    [rules[idx - 1], rules[idx]] = [rules[idx], rules[idx - 1]];
    await StorageManager.set({ rules });
    await renderRules();
  }));

  wrap.querySelectorAll('.down').forEach(btn => btn.addEventListener('click', async e => {
    const idx = Number(e.target.dataset.idx);
    const rules = (await StorageManager.get({ rules: [] })).rules;
    if (idx >= rules.length - 1) return;
    [rules[idx + 1], rules[idx]] = [rules[idx], rules[idx + 1]];
    await StorageManager.set({ rules });
    await renderRules();
  }));

  wrap.querySelectorAll('.edit').forEach(btn => btn.addEventListener('click', async e => {
    const idx = Number(e.target.dataset.idx);
    const rules = (await StorageManager.get({ rules: [] })).rules;
    const rule = rules[idx];
    editingIndex = idx;
    document.getElementById('ruleName').value = rule.name || '';
    document.getElementById('query').value = rule.query || '';
    document.getElementById('folder').value = rule.folder || '';
    document.getElementById('ruleBasePath').value = rule.basePath || '';
    document.getElementById('saveMode').value = rule.saveMode || 'combined';
    await loadSources(rule.accountIds || [], rule.folderKeys || []);
    fillBuilderFromQuery(rule.query || '');
    document.getElementById('addRule').style.display = 'none';
    document.getElementById('saveEdit').style.display = '';
    document.getElementById('cancelEdit').style.display = '';
    setEditorMode(true, rule.name || '');
    setFormMessage('Вы редактируете существующее правило.');
    updateQueryPreview();
    document.getElementById('ruleEditor').scrollIntoView({ block: 'start', behavior: 'smooth' });
  }));
}

async function init() {
  try {
    const mf = await messenger.runtime.sendMessage({ type: 'getManifestInfo' });
    document.getElementById('pluginVersion').textContent = `Версия: ${mf.version}`;
  } catch (e) {}
  const state = await StorageManager.get({ settings: { selectedAccounts: [] } });
  const settings = state.settings || { selectedAccounts: [] };
  await loadSources((settings.selectedAccounts || []).map(String), []);
  await renderRules();
}

document.getElementById('buildQuery').addEventListener('click', () => {
  const built = queryFromBuilder();
  if (!built) {
    setFormMessage('Введите значение для нового условия.', 'error');
    document.getElementById('valueInput').focus();
    return;
  }
  const q = document.getElementById('query');
  // The existing expression may contain OR.  Parentheses make the added
  // condition apply to the whole rule, rather than only to its last branch.
  q.value = q.value.trim() ? `(${q.value.trim()}) AND (${built})` : built;
  setFormMessage('');
  updateQueryPreview();
});

document.getElementById('replaceQuery').addEventListener('click', () => {
  const built = queryFromBuilder();
  if (!built) {
    setFormMessage('Введите значение условия.', 'error');
    document.getElementById('valueInput').focus();
    return;
  }
  document.getElementById('query').value = built;
  setFormMessage('');
  updateQueryPreview();
});

document.getElementById('query').addEventListener('input', updateQueryPreview);
document.getElementById('valueInput').addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault();
    document.getElementById('replaceQuery').click();
  }
});
document.getElementById('clearForm').addEventListener('click', resetForm);
document.getElementById('testRulesBtn').addEventListener('click', runRuleTest);
document.getElementById('addRule').addEventListener('click', async () => {
  const rule = await collectRuleForm();
  if (!rule) return;
  const rules = (await StorageManager.get({ rules: [] })).rules;
  rules.push(rule);
  await StorageManager.set({ rules });
  await renderRules();
  resetForm();
  setFormMessage('Правило создано.', 'success');
});

document.getElementById('saveEdit').addEventListener('click', async () => {
  if (editingIndex < 0) return;
  const rules = (await StorageManager.get({ rules: [] })).rules;
  const updated = await collectRuleForm(rules[editingIndex]);
  if (!updated) return;
  rules[editingIndex] = updated;
  await StorageManager.set({ rules });
  await renderRules();
  resetForm();
  setFormMessage('Изменения сохранены.', 'success');
});

document.getElementById('cancelEdit').addEventListener('click', resetForm);
document.getElementById('exportRulesFile').addEventListener('click', () => {
  exportRulesFile().catch(error => setRuleFileStatus(`Ошибка сохранения: ${error}`, 'error'));
});
document.getElementById('importRulesFile').addEventListener('click', () => {
  document.getElementById('ruleFileInput').click();
});
document.getElementById('ruleFileInput').addEventListener('change', event => {
  importRulesFile(event.target.files && event.target.files[0]);
});
window.addEventListener('DOMContentLoaded', init);

const openPluginSettingsBtn = document.getElementById('openPluginSettings');
if (openPluginSettingsBtn) openPluginSettingsBtn.addEventListener('click', async () => { await messenger.tabs.create({ url: '/settingsTab/settings.html' }); });

async function waitForForceExport() {
  for (;;) {
    await new Promise(resolve => setTimeout(resolve, 500));
    const state = await messenger.runtime.sendMessage({ type: 'getExportState' });
    const statusEl = document.getElementById('testStatus');
    if (state && state.running) {
      if (statusEl) {
        statusEl.textContent = `Перепроверка: писем ${state.checkedMessages || 0}, сохранено ${state.saved || 0}`;
      }
      continue;
    }
    return state || {};
  }
}

document.getElementById('reprocessExisting').addEventListener('click', async () => {
  const btn = document.getElementById('reprocessExisting');
  const statusEl = document.getElementById('testStatus');
  const ok = confirm('Перепроверить уже существующие письма по текущим правилам? Это нужно после добавления новых правил для старых писем.');
  if (!ok) return;
  btn.disabled = true;
  const prev = btn.textContent;
  btn.textContent = 'Перепроверка...';
  if (statusEl) statusEl.textContent = 'Запущена перепроверка старых писем...';
  try {
    await messenger.runtime.sendMessage({ type: 'forceExportExistingMessages' });
    const res = await waitForForceExport();
    if (statusEl) {
      statusEl.textContent = res.error
        ? `Ошибка перепроверки: ${res.error}`
        : `Перепроверка завершена. Проверено писем: ${res.checkedMessages || 0}, сохранено: ${res.saved || 0}`;
    }
  } catch (e) {
    if (statusEl) statusEl.textContent = 'Ошибка перепроверки: ' + e;
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
  }
});
