import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEVELOPER_LOG_LIMIT,
  buildDiagnosticSnapshot,
  logDeveloperEvent,
  normalizeDeveloperEvent
} from '../modules/developerLog.mjs';

test('normalizeDeveloperEvent removes attachment content and body fields', () => {
  const row = normalizeDeveloperEvent({
    operationId: 'save-1',
    area: 'save',
    stage: 'attachment',
    details: {
      messageId: 10,
      body: 'secret message body',
      content: 'attachment bytes',
      nested: { buffer: 'secret', status: 'ok' }
    }
  }, 1000);

  assert.equal(row.operationId, 'save-1');
  assert.equal(row.details.messageId, 10);
  assert.equal('body' in row.details, false);
  assert.equal('content' in row.details, false);
  assert.equal('buffer' in row.details.nested, false);
  assert.equal(row.details.nested.status, 'ok');
});

test('diagnostic snapshot reports counts without exporting paths or account identifiers', () => {
  const snapshot = buildDiagnosticSnapshot({
    pluginVersion: '1.2.3',
    storage: {
      settings: {
        basePath: 'Secret/Folder',
        selectedAccounts: ['private-account'],
        enableTags: true
      },
      rules: [{ query: 'from:secret@example.com' }],
      attachmentLogs: [{ fullPath: '/private/file.pdf' }],
      exportRegistry: [{ fullPath: '/private/file.pdf' }]
    },
    entries: [
      { area: 'scan', details: { messageId: 0 } },
      {
        area: 'save',
        details: {
          messageId: 1,
          fullPath: '/private/file.pdf',
          senderEmail: 'secret@example.com',
          ruleName: 'Confidential rule'
        }
      }
    ]
  });

  assert.equal(snapshot.pluginVersion, '1.2.3');
  assert.equal(snapshot.configuration.selectedAccountsCount, 1);
  assert.equal(snapshot.storageCounts.rules, 1);
  assert.equal(snapshot.storageCounts.attachmentLogs, 1);
  assert.equal(snapshot.storageCounts.exportRegistry, 1);
  assert.equal('basePath' in snapshot.configuration, false);
  assert.equal(JSON.stringify(snapshot).includes('secret@example.com'), false);
  assert.equal(JSON.stringify(snapshot).includes('/private/file.pdf'), false);
  assert.equal(JSON.stringify(snapshot).includes('Confidential rule'), false);
  assert.equal(snapshot.entries.length, 1);
  assert.equal(snapshot.entrySummary.legacyScanOmitted, 1);
  assert.equal(snapshot.entries[0].details.fullPath, '[redacted]');
});

test('logDeveloperEvent keeps only the latest bounded entries', async () => {
  let stored = Array.from(
    { length: DEVELOPER_LOG_LIMIT },
    (_, index) => ({ stage: `old-${index}` })
  );
  const update = async (_key, updater) => {
    stored = updater(stored);
  };

  await logDeveloperEvent({ stage: 'new' }, update);

  assert.equal(stored.length, DEVELOPER_LOG_LIMIT);
  assert.equal(stored.at(-1).stage, 'new');
  assert.equal(stored[0].stage, 'old-1');
});
