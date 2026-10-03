import { DEFAULT_SETTINGS } from '../core/settingsService.mjs';
import {
  createOperationId,
  buildDiagnosticSnapshot,
  DEVELOPER_LOG_KEY,
  logDeveloperEvent
} from '../modules/developerLog.mjs';

const RESET_KEYS = [
  'attachmentLogs',
  'messageAuditLogs',
  'retryLogs',
  'ruleTestLogs',
  'viewedMessages',
  'exportState'
];

let persistedSettings = { ...DEFAULT_SETTINGS };
let isInitializing = true;

const byId = id => document.getElementById(id);

function sanitizeRelativePath(value) {
  return String(value || '')
    .replace(/^([A-Za-z]:)?[\\/]+/, '')
    .replace(/\.\.+/g, '')
    .replace(/[<>:"|?*\x00-\x1F]/g, '_')
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');
}

function readForm() {
  return {
    basePath: sanitizeRelativePath(byId('basePath').value.trim()) || DEFAULT_SETTINGS.basePath,
    liveMode: byId('liveMode').checked,
    forceNoDuplicates: true,
    showAuditButton: byId('showAuditButton').checked,
    showResetMenu: byId('showResetMenu').checked,
    stopAfterFirstMatch: byId('stopAfterFirstMatch').checked,
    enableTags: byId('enableTags').checked,
    enableNotifications: byId('enableNotifications').checked,
    autoReportEnabled: byId('autoReportEnabled').checked,
    autoReportIntervalMinutes: Number(byId('autoReportIntervalMinutes').value) || DEFAULT_SETTINGS.autoReportIntervalMinutes
  };
}

function writeForm(settings) {
  const value = { ...DEFAULT_SETTINGS, ...settings };
  byId('basePath').value = value.basePath || DEFAULT_SETTINGS.basePath;
  byId('liveMode').checked = value.liveMode !== false;
  byId('showAuditButton').checked = value.showAuditButton === true;
  byId('showResetMenu').checked = value.showResetMenu === true;
  byId('stopAfterFirstMatch').checked = value.stopAfterFirstMatch === true;
  byId('enableTags').checked = value.enableTags !== false;
  byId('enableNotifications').checked = value.enableNotifications !== false;
  byId('autoReportEnabled').checked = value.autoReportEnabled === true;
  byId('autoReportIntervalMinutes').value = String(value.autoReportIntervalMinutes || DEFAULT_SETTINGS.autoReportIntervalMinutes);
  updateView();
}

function updateView() {
  const settings = readForm();
  byId('serviceSection').hidden = !settings.showResetMenu;
  byId('summaryLiveMode').textContent = settings.liveMode ? 'Включена' : 'Выключена';
  byId('summaryMatchMode').textContent = settings.stopAfterFirstMatch ? 'Первое совпадение' : 'Все совпадения';
  byId('summaryTags').textContent = settings.enableTags ? 'Включены' : 'Выключены';
  byId('summaryBasePath').textContent = settings.basePath;
  byId('autoReportIntervalMinutes').disabled = !settings.autoReportEnabled;
}

function setSaveStatus(message, type = '') {
  const el = byId('saveStatus');
  el.textContent = message;
  el.className = `save-status${type ? ` ${type}` : ''}`;
}

function markDirty() {
  updateView();
  if (!isInitializing) setSaveStatus('Есть несохранённые изменения', 'dirty');
}

async function openRules() {
  await messenger.tabs.create({ url: '/rulesTab/rules.html' });
  window.close();
}

async function saveSettings() {
  const button = byId('saveSettings');
  button.disabled = true;
  setSaveStatus('Сохранение…');
  try {
    const formSettings = readForm();
    const settings = {
      ...persistedSettings,
      ...formSettings,
      selectedAccounts: Array.isArray(persistedSettings.selectedAccounts)
        ? persistedSettings.selectedAccounts.map(String)
        : []
    };
    await messenger.storage.local.set({ settings, messageListener: settings.liveMode });
    persistedSettings = settings;
    byId('basePath').value = settings.basePath;
    setSaveStatus('Настройки сохранены', 'success');
  } catch (error) {
    setSaveStatus(`Не удалось сохранить: ${error}`, 'error');
  } finally {
    button.disabled = false;
  }
}

async function diagnoseTags() {
  const button = byId('diagTagsBtn');
  const result = byId('diagTagsResult');
  button.disabled = true;
  result.textContent = 'Проверка API тегов…';
  try {
    const data = await messenger.runtime.sendMessage({ type: 'diagnoseTags' });
    const available = data.hasUpdate && data.created;
    const canList = data.hasTagsList || data.hasListTags;
    const mapped = data.mappedTags || {};
    const lines = [
      available ? '✔ Теги доступны.' : '✖ Теги в этом почтовом клиенте недоступны.',
      `API тегов: ${data.hasTagsNamespace ? 'есть' : 'нет'}`,
      `Чтение списка тегов: ${canList ? 'доступно' : 'недоступно'}`,
      `Создание тегов: ${(data.hasTagsCreate || data.hasCreateTag) ? 'доступно' : 'недоступно'}`,
      `Изменение письма: ${data.hasUpdate ? 'доступно' : 'недоступно'}`,
      `Теги готовы: ${data.created ? 'да' : 'нет'}`,
      `Сопоставление: Рабочее=${mapped.processed || '—'}, Важное=${mapped.error || '—'}, К исполнению=${mapped.review || '—'}`
    ];
    if (data.error) lines.push(`Примечание: ${data.error}`);
    result.textContent = lines.join('\n');
  } catch (error) {
    result.textContent = `Ошибка диагностики: ${error}`;
  } finally {
    button.disabled = false;
  }
}

async function deleteLoggedFiles(operationId) {
  const { attachmentLogs = [] } = await messenger.storage.local.get({ attachmentLogs: [] });
  const seen = new Set();
  const files = [];
  for (const row of Array.isArray(attachmentLogs) ? attachmentLogs : []) {
    if (String(row?.status || '') !== 'success') continue;
    const downloadId = row?.downloadId ?? null;
    const fullPath = String(row?.fullPath || '').trim();
    const savedAs = String(row?.savedAs || '').trim();
    const attachmentName = String(row?.attachmentName || '').trim();
    const contentHash = String(row?.contentHash || '').trim();
    const key = downloadId != null
      ? `download:${downloadId}`
      : fullPath
        ? `path:${fullPath.toLowerCase()}`
        : savedAs
          ? `saved:${savedAs.toLowerCase()}`
          : `name:${attachmentName.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (downloadId != null || fullPath || savedAs || attachmentName) {
      files.push({ downloadId, fullPath, savedAs, attachmentName, contentHash });
    }
  }
  return messenger.runtime.sendMessage({ type: 'deleteDownloadedFiles', files, operationId });
}

async function clearLoggedMessageTags() {
  const { messageAuditLogs = [] } = await messenger.storage.local.get({ messageAuditLogs: [] });
  const messageIds = [...new Set(
    (Array.isArray(messageAuditLogs) ? messageAuditLogs : [])
      .map(row => row?.messageId)
      .filter(Boolean)
  )];
  return messenger.runtime.sendMessage({ type: 'clearMessageTags', messageIds });
}

async function resetPluginState() {
  if (!confirm('Удалить статистику, историю обработок и скачанные плагином файлы? Правила и настройки сохранятся.')) return;
  const button = byId('resetPluginBtn');
  button.disabled = true;
  button.textContent = 'Выполняется сброс…';
  const operationId = createOperationId('reset');
  try {
    await logDeveloperEvent({
      operationId,
      area: 'reset',
      stage: 'started',
      details: {}
    });
    const deletedInfo = await deleteLoggedFiles(operationId);
    const tagsInfo = await clearLoggedMessageTags();
    const registryReleased = Array.isArray(deletedInfo.diagnostics)
      ? deletedInfo.diagnostics.filter(row => row && row.type === 'registry' && row.ok).length
      : 0;
    await messenger.storage.local.remove(RESET_KEYS);
    await messenger.storage.local.set({
      attachmentLogs: [],
      messageAuditLogs: [],
      retryLogs: [],
      ruleTestLogs: [],
      viewedMessages: [],
      exportState: {
        running: false, processed: 0, done: false, error: '',
        startedAt: 0, finishedAt: 0
      },
      resetDiagnostics: {
        tags: Array.isArray(tagsInfo.diagnostics) ? tagsInfo.diagnostics : [],
        downloads: Array.isArray(deletedInfo.diagnostics) ? deletedInfo.diagnostics : [],
        totals: {
          tagCandidates: Array.isArray(tagsInfo.diagnostics)
            ? tagsInfo.diagnostics.length
            : Number(tagsInfo.cleared || 0) + Number(tagsInfo.failed || 0),
          downloadCandidates: Number(deletedInfo.deleted || 0) + Number(deletedInfo.failed || 0),
          cleared: Number(tagsInfo.cleared || 0),
          tagFailed: Number(tagsInfo.failed || 0),
          deleted: Number(deletedInfo.deleted || 0),
          downloadFailed: Number(deletedInfo.failed || 0),
          registryReleased
        },
        createdAt: Date.now()
      }
    });
    await logDeveloperEvent({
      operationId,
      area: 'reset',
      stage: 'completed',
      ok: Number(deletedInfo.failed || 0) === 0,
      details: {
        deleted: Number(deletedInfo.deleted || 0),
        failed: Number(deletedInfo.failed || 0),
        registryReleased
      }
    });
    byId('resetDiagResult').textContent =
      `Сброс завершён.\nУдалено файлов: ${deletedInfo.deleted || 0}\n` +
      `Не удалось удалить: ${deletedInfo.failed || 0}\n` +
      `Реестр дублей: снята защита для ${registryReleased} из ${deletedInfo.deleted || 0} удалённых файлов\n` +
      `Очищено писем от меток: ${tagsInfo.cleared || 0}\n` +
      `Не удалось очистить: ${tagsInfo.failed || 0}`;
  } catch (error) {
    await logDeveloperEvent({
      operationId,
      area: 'reset',
      stage: 'failed',
      ok: false,
      details: { error: String(error) }
    });
    byId('resetDiagResult').textContent = `Ошибка сброса: ${error}`;
  } finally {
    button.disabled = false;
    button.textContent = 'Сбросить данные';
  }
}

async function showResetDiagnostics() {
  const result = byId('resetDiagResult');
  result.textContent = 'Загрузка…';
  try {
    const { resetDiagnostics: data } = await messenger.storage.local.get({ resetDiagnostics: null });
    if (!data) {
      result.textContent = 'Диагностика ещё не накоплена.';
      return;
    }
    const totals = data.totals || {};
    const lines = [
      `Время: ${data.createdAt ? new Date(data.createdAt).toLocaleString() : 'неизвестно'}`,
      `Метки: кандидатов ${totals.tagCandidates || 0}, очищено ${totals.cleared || 0}, ошибок ${totals.tagFailed || 0}`,
      `Файлы: кандидатов ${totals.downloadCandidates || 0}, удалено ${totals.deleted || 0}, ошибок ${totals.downloadFailed || 0}`,
      `Реестр дублей: снята защита для ${totals.registryReleased || 0} из ${totals.deleted || 0} удалённых файлов`
    ];
    const tagErrors = (data.tags || []).filter(row => !row.ok);
    const downloadErrors = (data.downloads || []).filter(row => !row.ok);
    if (tagErrors.length || downloadErrors.length) {
      lines.push('', 'Ошибки:');
      tagErrors.forEach(row => lines.push(`• письмо ${row.messageId || '—'}: ${row.error || row.note || 'не очищено'}`));
      downloadErrors.forEach(row => lines.push(`• файл ${row.fullPath || row.downloadId || '—'}: ${row.error || 'не удалён'}`));
    }
    result.textContent = lines.join('\n');
  } catch (error) {
    result.textContent = `Ошибка чтения диагностики: ${error}`;
  }
}

async function clearResetDiagnostics() {
  await messenger.storage.local.remove('resetDiagnostics');
  byId('resetDiagResult').textContent = 'Диагностика очищена.';
}

async function readDeveloperLog() {
  const state = await messenger.storage.local.get({ [DEVELOPER_LOG_KEY]: [] });
  return Array.isArray(state[DEVELOPER_LOG_KEY]) ? state[DEVELOPER_LOG_KEY] : [];
}

async function developerLogJson() {
  const rows = await readDeveloperLog();
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    pluginVersion: byId('pluginVersion').textContent.replace(/^Версия:\s*/, ''),
    entries: rows
  }, null, 2);
}

async function diagnosticSnapshotJson() {
  const [entries, context, storage] = await Promise.all([
    readDeveloperLog(),
    messenger.runtime.sendMessage({ type: 'getDiagnosticContext' }),
    messenger.storage.local.get({
      settings: {},
      rules: [],
      attachmentLogs: [],
      messageAuditLogs: [],
      retryLogs: [],
      ruleTestLogs: [],
      viewedMessages: [],
      exportRegistry: [],
      exportState: {},
      resetDiagnostics: null,
      statisticsDiagnostics: {}
    })
  ]);
  return JSON.stringify(buildDiagnosticSnapshot({
    pluginVersion: byId('pluginVersion').textContent.replace(/^Версия:\s*/, ''),
    session: {
      sessionId: context.sessionId || '',
      platform: context.platform || null,
      browserInfo: context.browserInfo || null
    },
    storage,
    tagDiagnostics: context.tags || {},
    statisticsDiagnostics: storage.statisticsDiagnostics || {},
    entries
  }), null, 2);
}

async function downloadDiagnosticSnapshot() {
  const result = byId('developerLogResult');
  try {
    result.textContent = 'Подготовка снимка диагностики…';
    const json = await diagnosticSnapshotJson();
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    await messenger.downloads.download({
      url,
      filename: `inbox-weaver-diagnostic-snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
      saveAs: true
    });
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    result.textContent = 'Снимок диагностики подготовлен.';
  } catch (error) {
    result.textContent = `Не удалось подготовить снимок: ${error}`;
  }
}

async function copyDeveloperLog() {
  const result = byId('developerLogResult');
  try {
    const json = await developerLogJson();
    await navigator.clipboard.writeText(json);
    result.textContent = `Скопировано записей: ${(await readDeveloperLog()).length}`;
  } catch (error) {
    result.textContent = `Не удалось скопировать: ${error}`;
  }
}

async function downloadDeveloperLog() {
  const result = byId('developerLogResult');
  try {
    const json = await developerLogJson();
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    await messenger.downloads.download({
      url,
      filename: `inbox-weaver-developer-log-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
      saveAs: true
    });
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    result.textContent = `Журнал подготовлен: ${(await readDeveloperLog()).length} записей`;
  } catch (error) {
    result.textContent = `Не удалось скачать журнал: ${error}`;
  }
}

async function clearDeveloperLog() {
  await messenger.storage.local.remove(DEVELOPER_LOG_KEY);
  byId('developerLogResult').textContent = 'Журнал разработчика очищен.';
}

async function init() {
  try {
    const manifest = await messenger.runtime.sendMessage({ type: 'getManifestInfo' });
    byId('pluginVersion').textContent = `Версия: ${manifest.version}`;
  } catch (_) {
    byId('pluginVersion').textContent = 'Версия: неизвестна';
  }

  const { settings = {} } = await messenger.storage.local.get({ settings: {} });
  persistedSettings = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  writeForm(persistedSettings);
  isInitializing = false;
  setSaveStatus('Изменений нет');
}

document.querySelectorAll('input').forEach(input => {
  input.addEventListener(input.type === 'checkbox' ? 'change' : 'input', markDirty);
});
byId('openRules').addEventListener('click', openRules);
byId('openRulesSecondary').addEventListener('click', openRules);
byId('saveSettings').addEventListener('click', saveSettings);
byId('defaultsBtn').addEventListener('click', () => {
  writeForm({ ...DEFAULT_SETTINGS, selectedAccounts: persistedSettings.selectedAccounts });
  markDirty();
});
byId('diagTagsBtn').addEventListener('click', diagnoseTags);
byId('resetPluginBtn').addEventListener('click', resetPluginState);
byId('showResetDiagBtn').addEventListener('click', showResetDiagnostics);
byId('clearResetDiagBtn').addEventListener('click', clearResetDiagnostics);
byId('copyDeveloperLogBtn').addEventListener('click', copyDeveloperLog);
byId('downloadDiagnosticSnapshotBtn').addEventListener('click', downloadDiagnosticSnapshot);
byId('downloadDeveloperLogBtn').addEventListener('click', downloadDeveloperLog);
byId('clearDeveloperLogBtn').addEventListener('click', clearDeveloperLog);
window.addEventListener('DOMContentLoaded', init);
