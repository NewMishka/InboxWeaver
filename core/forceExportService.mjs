import { selectForceExportFolders } from './accountService.mjs';
import { createSingleFlight } from '../modules/singleFlight.mjs';
import {
  createOperationId,
  logDeveloperEvent
} from '../modules/developerLog.mjs';
import {
  MAIL_API_TIMEOUT_MS,
  isOperationTimeout,
  withTimeout as withDefaultTimeout
} from '../modules/operationTimeout.mjs';

export function createForceExportService({
  messenger,
  getRules,
  getSettings,
  processMessage,
  updateState,
  createLogBatcher = null,
  logger = console,
  developerLog = logDeveloperEvent,
  mailApiTimeoutMs = MAIL_API_TIMEOUT_MS,
  withTimeout = withDefaultTimeout
}) {
  const flight = createSingleFlight();
  let activeRun = null;
  let activity = {};

  const trace = async event => {
    try {
      await developerLog(event);
    } catch (_) {}
  };
  const runTimed = async (operationName, operation, messageId = '') => {
    activity = {
      currentStage: operationName,
      currentMessageId: messageId ? String(messageId) : '',
      currentStartedAt: Date.now()
    };
    return await withTimeout(operation, { operationName, timeoutMs: mailApiTimeoutMs });
  };

  async function scan(operationId, cancellation) {
    const rules = await getRules();
    if (!rules.length) return { processed: 0, saved: 0 };
    const settings = await getSettings();
    const selectedIds = (settings.selectedAccounts || []).map(String);
    const accounts = await runTimed('accounts.list', () => messenger.accounts.list());
    let processed = 0;
    let saved = 0;
    let checkedMessages = 0;
    let failedMessages = 0;
    let scannedFolders = 0;
    let lastProgressWriteAt = 0;
    const logBatcher = createLogBatcher ? createLogBatcher() : null;
    const logSink = logBatcher
      ? { logAttachment: logBatcher.logAttachment, logMessageAudit: logBatcher.logMessageAudit }
      : null;
    const wasStopped = () => cancellation.stopRequested === true;

    async function publishProgress(force = false) {
      const now = Date.now();
      if (!force && checkedMessages % 25 !== 0 && now - lastProgressWriteAt < 1000) return;
      lastProgressWriteAt = now;
      if (logBatcher) await logBatcher.flush();
      await updateState({
        processed,
        saved,
        scannedFolders,
        checkedMessages,
        failedMessages
      });
    }

    for (const account of (accounts || [])) {
      if (wasStopped()) break;
      const folders = selectForceExportFolders(account, rules, selectedIds);
      for (const folder of folders) {
        if (wasStopped()) break;
        scannedFolders += 1;
        await publishProgress(true);
        let page;
        try {
          page = await runTimed('messages.list', () => messenger.messages.list(folder));
        } catch (error) {
          failedMessages += 1;
          await trace({
            operationId,
            area: 'force-export',
            stage: 'folder-list-failed',
            ok: false,
            details: {
              accountId: account.id || '',
              folderPath: folder.path || folder.name || '',
              error: String(error)
            }
          });
          await updateState({
            scannedFolders,
            checkedMessages,
            failedMessages,
            lastError: String(error)
          });
          continue;
        }

        while (page) {
          for (const message of (page.messages || [])) {
            if (wasStopped()) break;
            checkedMessages += 1;
            try {
              const result = await runTimed('message-processing', () =>
                processMessage(message.id, { logSink }), message.id
              );
              processed += Number(result && result.processed || 0);
              saved += Number(result && result.saved || 0);
              if (result && (result.status === 'error' || result.timeout === true)) {
                failedMessages += 1;
                const mailOperation = result.mailOperation ||
                  (result.timeout ? 'message-processing' : 'message-processing');
                await trace({
                  operationId,
                  area: 'force-export',
                  stage: 'message-processing-error',
                  ok: false,
                  details: {
                    messageId: message.id,
                    accountId: account.id || '',
                    folderPath: folder.path || folder.name || '',
                    mailOperation,
                    error: String(result.error || result.reason || '')
                  }
                });
                await updateState({
                  lastError: String(result.error || result.reason || ''),
                  lastFailedMessageId: String(message.id),
                  lastFailedStage: mailOperation
                });
              }
            } catch (error) {
              failedMessages += 1;
              await trace({
                operationId,
                area: 'force-export',
                stage: 'message-failed',
                ok: false,
                details: {
                  messageId: message.id,
                  accountId: account.id || '',
                  folderPath: folder.path || folder.name || '',
                  timedOut: isOperationTimeout(error),
                  mailOperation: error && error.mailOperation || '',
                  error: String(error)
                }
              });
              await updateState({
                lastError: String(error),
                lastFailedMessageId: String(message.id),
                lastFailedStage: isOperationTimeout(error)
                  ? error.operation
                  : (error && error.mailOperation) || 'message-processing'
              });
            }
            await publishProgress();
          }
          if (wasStopped()) break;
          if (!page.id) break;
          try {
            page = await runTimed('messages.continueList', () =>
              messenger.messages.continueList(page.id)
            );
          } catch (error) {
            await trace({
              operationId,
              area: 'force-export',
              stage: 'continue-list-failed',
              ok: false,
              details: {
                accountId: account.id || '',
                folderPath: folder.path || folder.name || '',
                error: String(error)
              }
            });
            break;
          }
        }
      }
    }

    const stopped = wasStopped();
    if (checkedMessages > 0 || stopped) {
      messenger.notifications.create({
        type: 'basic',
        title: 'Менеджер писем',
        message: stopped
          ? `Проверка остановлена. Проверено писем: ${checkedMessages}`
          : `Проверка завершена. Проверено писем: ${checkedMessages}`
      });
    }
    await publishProgress(true);
    return { processed, saved, scannedFolders, checkedMessages, failedMessages, stopped };
  }

  async function runCore() {
    const operationId = createOperationId('force-export');
    const cancellation = { stopRequested: false };
    activeRun = cancellation;
    await trace({
      operationId,
      area: 'force-export',
      stage: 'started',
      details: {}
    });
    await updateState({
      running: true,
      processed: 0,
      saved: 0,
      scannedFolders: 0,
      checkedMessages: 0,
      failedMessages: 0,
      lastError: '',
      done: false,
      stopping: false,
      stopped: false,
      error: '',
      currentStage: '',
      currentMessageId: '',
      currentStartedAt: 0,
      lastFailedMessageId: '',
      lastFailedStage: '',
      startedAt: Date.now(),
      finishedAt: 0
    });
    try {
      const result = await scan(operationId, cancellation);
      await updateState({
        running: false,
        stopping: false,
        stopped: result.stopped === true,
        processed: result.processed || 0,
        saved: result.saved || 0,
        scannedFolders: result.scannedFolders || 0,
        checkedMessages: result.checkedMessages || 0,
        failedMessages: result.failedMessages || 0,
        currentStage: '',
        currentMessageId: '',
        currentStartedAt: 0,
        done: true,
        finishedAt: Date.now()
      });
      await trace({
        operationId,
        area: 'force-export',
        stage: result.stopped ? 'stopped' : 'completed',
        ok: Number(result.failedMessages || 0) === 0,
        details: result
      });
      return result;
    } catch (error) {
      await updateState({
        running: false,
        stopping: false,
        stopped: false,
        done: true,
        error: String(error),
        finishedAt: Date.now()
      });
      await trace({
        operationId,
        area: 'force-export',
        stage: 'failed',
        ok: false,
        details: { error: String(error) }
      });
      return { processed: 0, error: String(error) };
    } finally {
      if (activeRun === cancellation) activeRun = null;
      activity = {};
    }
  }

  async function run() {
    return await flight.run('force-export', runCore);
  }

  function start() {
    if (flight.has('force-export')) return { started: false, running: true };
    run().catch(error => logger.error('force export failed', error));
    return { started: true, running: true };
  }

  function stop() {
    if (!activeRun || !flight.has('force-export')) {
      return { stopped: false, running: false };
    }
    activeRun.stopRequested = true;
    updateState({ stopping: true }).catch(error =>
      logger.error('could not mark force export as stopping', error)
    );
    return { stopped: true, running: true };
  }

  return {
    run,
    start,
    stop,
    get running() { return flight.has('force-export'); },
    get currentActivity() { return activity; }
  };
}
