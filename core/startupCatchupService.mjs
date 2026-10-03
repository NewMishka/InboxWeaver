import { selectForceExportFolders } from './accountService.mjs';

const DEFAULTS = Object.freeze({
  delayMs: 8000,
  fallbackWindowMs: 24 * 60 * 60 * 1000,
  overlapMs: 2 * 60 * 1000,
  maxMessages: 5000,
  maxPages: 200,
  heartbeatMs: 60 * 1000,
  checkpointKey: 'mailObservationCheckpoint'
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function createStartupCatchupService({
  messenger,
  getSettings,
  getRules,
  processMessage,
  logAudit,
  now = () => Date.now(),
  wait = sleep,
  logger = console,
  options = {}
}) {
  const config = { ...DEFAULTS, ...(options || {}) };
  let started = false;
  let running = false;
  let heartbeatId = null;

  async function getCheckpoint() {
    const stored = await messenger.storage.local.get({ [config.checkpointKey]: 0 });
    const value = Number(stored && stored[config.checkpointKey] || 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  async function recordObservation(timestamp = now()) {
    const value = Number(timestamp);
    await messenger.storage.local.set({
      [config.checkpointKey]: Number.isFinite(value) ? value : now()
    });
  }

  async function listRecentMessages(folder, cutoffTime) {
    const found = [];
    let page;
    try {
      page = await messenger.messages.list(folder);
    } catch (_) {
      return found;
    }
    let pageCount = 0;
    while (page && pageCount < config.maxPages && found.length < config.maxMessages) {
      const pageMessages = Array.isArray(page.messages) ? page.messages : [];
      for (const message of pageMessages) {
        const messageTime = new Date(message && message.date || 0).getTime();
        if (Number.isFinite(messageTime) && messageTime >= cutoffTime) found.push(message);
        if (found.length >= config.maxMessages) break;
      }
      const oldestTime = pageMessages.length
        ? new Date(pageMessages[pageMessages.length - 1].date || 0).getTime()
        : 0;
      if (oldestTime && oldestTime < cutoffTime) break;
      if (!page.id) break;
      try {
        page = await messenger.messages.continueList(page.id);
      } catch (_) {
        break;
      }
      pageCount += 1;
    }
    return found;
  }

  async function run() {
    if (started) return { started: false, skipped: true };
    started = true;
    running = true;
    const startedAt = now();
    try {
      await wait(config.delayMs);
      const settings = await getSettings();
      if (!settings.liveMode) return { started: true, skipped: true, reason: 'live-mode-disabled' };
      const rules = await getRules();
      if (!rules.length) return { started: true, skipped: true, reason: 'no-rules' };

      const selectedIds = new Set((settings.selectedAccounts || []).map(String));
      const accounts = await messenger.accounts.list();
      const checkpoint = await getCheckpoint();
      const cutoffTime = checkpoint > 0
        ? Math.max(0, checkpoint - config.overlapMs)
        : startedAt - config.fallbackWindowMs;
      const messageMap = new Map();

      for (const account of (accounts || [])) {
        const accountId = String(account.id || '');
        if (selectedIds.size && !selectedIds.has(accountId)) continue;
        const folders = selectForceExportFolders(account, rules, [...selectedIds]);
        for (const folder of folders) {
          const recentMessages = await listRecentMessages(folder, cutoffTime);
          for (const message of recentMessages) {
            if (message && message.id != null) messageMap.set(String(message.id), message);
          }
        }
      }

      const messages = [...messageMap.values()]
        .sort((left, right) => new Date(left.date || 0) - new Date(right.date || 0))
        .slice(-config.maxMessages);
      let processed = 0;
      let saved = 0;
      let failed = 0;
      for (const message of messages) {
        try {
          const result = await processMessage(message.id);
          processed += Number(result && result.processed || 0);
          saved += Number(result && result.saved || 0);
        } catch (error) {
          failed += 1;
          logger.error('startup catch-up message failed', message && message.id, error);
        }
      }

      await recordObservation(startedAt);
      await logAudit({
        checkedDate: new Date(now()).toLocaleDateString(),
        checkedTime: new Date(now()).toLocaleTimeString(),
        accountName: '',
        senderName: '',
        senderEmail: '',
        subject: '',
        messageId: '',
        ruleCheckedCount: 0,
        status: failed ? 'Обработано частично' : 'Проверено',
        reason: `Стартовая проверка: найдено ${messages.length}, обработано ${processed}, сохранено ${saved}, ошибок ${failed}`,
        processedCount: saved
      });
      return { started: true, found: messages.length, processed, saved, failed };
    } catch (error) {
      logger.error('startup catch-up failed', error);
      try {
        await logAudit({
          checkedDate: new Date(now()).toLocaleDateString(),
          checkedTime: new Date(now()).toLocaleTimeString(),
          accountName: '',
          senderName: '',
          senderEmail: '',
          subject: '',
          messageId: '',
          ruleCheckedCount: 0,
          status: 'Ошибка',
          reason: `Ошибка стартовой проверки: ${String(error)}`,
          processedCount: 0
        });
      } catch (_) {}
      return { started: true, failed: 1, error: String(error) };
    } finally {
      running = false;
    }
  }

  function startHeartbeat(setTimer = setInterval) {
    if (heartbeatId !== null) return heartbeatId;
    heartbeatId = setTimer(() => {
      if (running) return;
      recordObservation().catch(error => logger.error('mail observation checkpoint failed', error));
    }, config.heartbeatMs);
    return heartbeatId;
  }

  return {
    run,
    recordObservation,
    startHeartbeat,
    get running() {
      return running;
    }
  };
}
