document.addEventListener('DOMContentLoaded', async () => {
  const rulesBtn = document.getElementById('rules');
  const settingsBtn = document.getElementById('settings');
  const statisticsBtn = document.getElementById('statistics');
  const auditBtn = document.getElementById('audit');
  const forceExportBtn = document.getElementById('forceExport');
  const stopForceExportBtn = document.getElementById('stopForceExport');
  const status = document.getElementById('status');
  const pluginVersionMini = document.getElementById('pluginVersionMini');

  try {
    const mf = await messenger.runtime.sendMessage({ type: 'getManifestInfo' });
    if (pluginVersionMini) pluginVersionMini.textContent = `Версия: ${mf.version}`;
  } catch (e) {}

  try {
    const state = await messenger.storage.local.get({ settings: {} });
    const showAudit = state.settings && state.settings.showAuditButton === true;
    if (auditBtn) auditBtn.hidden = !showAudit;
  } catch (e) {}

  rulesBtn?.addEventListener('click', async () => { await messenger.tabs.create({ url: '/rulesTab/rules.html' }); window.close(); });
  settingsBtn?.addEventListener('click', async () => { await messenger.tabs.create({ url: '/settingsTab/settings.html' }); window.close(); });
  statisticsBtn?.addEventListener('click', async () => { await messenger.tabs.create({ url: '/statisticsTab/statistics.html' }); window.close(); });
  auditBtn?.addEventListener('click', async () => { await messenger.tabs.create({ url: '/auditTab/audit.html' }); window.close(); });
  function activityLabel(stage) {
    const labels = {
      'accounts.list': 'получаем ящики',
      'messages.list': 'читаем папку',
      'messages.continueList': 'читаем следующую страницу',
      'message-processing': 'проверяем письмо'
    };
    return labels[stage] || 'выполняем операцию';
  }

  function renderExportState(st) {
    if (!st) { status.textContent = 'Готов к работе'; return; }
    if (st.running === true) {
      const activity = st.currentStage
        ? `, ${activityLabel(st.currentStage)}${st.currentMessageId ? ` №${st.currentMessageId}` : ''}`
        : '';
      status.textContent = st.stopping
        ? `Останавливаем проверку: писем ${st.checkedMessages || 0}${activity}`
        : `Идёт проверка: писем ${st.checkedMessages || 0}${activity}`;
      if (forceExportBtn) forceExportBtn.disabled = true;
      if (stopForceExportBtn) {
        stopForceExportBtn.hidden = false;
        stopForceExportBtn.disabled = st.stopping === true;
      }
    } else if (st.error) {
      status.textContent = `Ошибка проверки: ${st.error}`;
      if (forceExportBtn) forceExportBtn.disabled = false;
      if (stopForceExportBtn) stopForceExportBtn.hidden = true;
    } else if (st.done) {
      if (st.stopped) {
        status.textContent = `Остановлено: проверено писем ${st.checkedMessages || 0}`;
      } else if ((st.checkedMessages || 0) > 0) {
        status.textContent = (st.failedMessages || 0) > 0
          ? `Готово с ошибками: проверено писем ${st.checkedMessages}, ошибок ${st.failedMessages}`
          : `Готово: проверено писем ${st.checkedMessages}`;
      } else if ((st.scannedFolders || 0) > 0) {
        status.textContent = `Готово: проверено папок ${st.scannedFolders}, писем не найдено`;
      } else {
        status.textContent = 'Не найдены ящики или папки, подходящие правилам';
      }
      if (forceExportBtn) forceExportBtn.disabled = false;
      if (stopForceExportBtn) stopForceExportBtn.hidden = true;
    } else {
      status.textContent = 'Готов к работе';
      if (forceExportBtn) forceExportBtn.disabled = false;
      if (stopForceExportBtn) stopForceExportBtn.hidden = true;
    }
  }

  let pollTimer = null;
  async function refreshExportState() {
    try {
      const st = await messenger.runtime.sendMessage({ type: 'getExportState' });
      renderExportState(st);
      if (st && st.running) {
        if (!pollTimer) pollTimer = setInterval(refreshExportState, 1000);
      } else if (pollTimer) {
        clearInterval(pollTimer); pollTimer = null;
      }
    } catch (e) {}
  }

  // При открытии popup показываем фактическое состояние проверки
  await refreshExportState();

  forceExportBtn?.addEventListener('click', async () => {
    try {
      status.textContent = 'Запускается проверка писем...';
      if (forceExportBtn) forceExportBtn.disabled = true;
      await messenger.runtime.sendMessage({ type: 'forceExportExistingMessages' });
      setTimeout(refreshExportState, 300);
    } catch (e) {
      status.textContent = 'Ошибка запуска проверки';
      if (forceExportBtn) forceExportBtn.disabled = false;
    }
  });

  stopForceExportBtn?.addEventListener('click', async () => {
    try {
      status.textContent = 'Останавливаем проверку после текущего письма...';
      stopForceExportBtn.disabled = true;
      await messenger.runtime.sendMessage({ type: 'stopForceExport' });
      setTimeout(refreshExportState, 100);
    } catch (e) {
      status.textContent = 'Не удалось остановить проверку';
      stopForceExportBtn.disabled = false;
    }
  });

  window.addEventListener('unload', () => { if (pollTimer) clearInterval(pollTimer); });
});
