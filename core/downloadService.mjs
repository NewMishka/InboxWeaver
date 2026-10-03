function normalizedPath(value) {
  return String(value || '').trim().replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase();
}

function baseName(value) {
  const parts = normalizedPath(value).split('/');
  return parts[parts.length - 1] || '';
}

import { logDeveloperEvent } from '../modules/developerLog.mjs';
import { forgetExportByHash } from '../modules/duplicateManager.mjs';

export async function deleteDownloadedFiles(
  fileRefs,
  downloads = messenger.downloads,
  context = {}
) {
  const refs = Array.isArray(fileRefs) ? fileRefs : [];
  const operationId = String(context.operationId || '');
  const developerLog = context.developerLog || logDeveloperEvent;
  const wait = context.wait || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const forgetHash = context.forgetExportByHash || forgetExportByHash;
  const trace = async event => {
    try {
      await developerLog(event);
    } catch (_) {}
  };
  const all = await downloads.search({});
  await trace({
    operationId,
    area: 'reset',
    stage: 'download-search',
    details: { requested: refs.length, foundInHistory: (all || []).length }
  });
  const byId = new Map((all || []).map(x => [String(x.id), x]));
  const byPath = new Map((all || []).map(x => [normalizedPath(x.filename), x]));
  let deleted = 0;
  let failed = 0;
  const diagnostics = [];
  for (const ref of refs) {
    const downloadId = ref && ref.downloadId != null ? String(ref.downloadId) : '';
    const fullPath = String(ref && ref.fullPath || '').trim();
    const savedAs = String(ref && ref.savedAs || '').trim();
    const attachmentName = String(ref && ref.attachmentName || '').trim();
    const contentHash = String(ref && ref.contentHash || '').trim();
    let item = null;
    if (downloadId && byId.has(downloadId)) item = byId.get(downloadId);
    else if (fullPath && byPath.has(normalizedPath(fullPath))) item = byPath.get(normalizedPath(fullPath));
    else if (savedAs) {
      const suffix = `/${normalizedPath(savedAs)}`;
      const matches = (all || []).filter(candidate =>
        normalizedPath(candidate.filename) === normalizedPath(savedAs) ||
        normalizedPath(candidate.filename).endsWith(suffix)
      );
      if (matches.length === 1) item = matches[0];
    }
    if (!item && attachmentName) {
      const matches = (all || []).filter(candidate =>
        baseName(candidate.filename) === baseName(attachmentName)
      );
      if (matches.length === 1) item = matches[0];
    }
    if (!item) {
      if (downloadId || fullPath || savedAs || attachmentName) {
        failed += 1;
        diagnostics.push({ type: 'download', downloadId, fullPath, savedAs, attachmentName, stage: 'lookup', ok: false, error: 'not found uniquely in downloads.search()' });
        await trace({
          operationId,
          area: 'reset',
          stage: 'file-lookup',
          ok: false,
          details: { downloadId, fullPath, savedAs, attachmentName, error: 'not-found-uniquely' }
        });
      }
      continue;
    }
    let removed = false;
    let removeError = '';
    let eraseError = '';
    try { await downloads.removeFile(item.id); removed = true; } catch (e) { removeError = String(e); }
    let existsAfterRemove = null;
    let verificationAttempts = 0;
    let verificationState = null;
    try {
      const delays = [0, 100, 250, 500];
      for (const delay of delays) {
        if (delay) await wait(delay);
        verificationAttempts += 1;
        const verification = await downloads.search({ id: item.id });
        const verified = Array.isArray(verification) ? verification[0] : null;
        verificationState = verified ? {
          id: verified.id,
          state: verified.state || '',
          exists: typeof verified.exists === 'boolean' ? verified.exists : null,
          error: verified.error || ''
        } : null;
        existsAfterRemove = verified && typeof verified.exists === 'boolean'
          ? verified.exists
          : (verified ? null : false);
        if (existsAfterRemove !== true) break;
      }
      if (existsAfterRemove === true) {
        removed = false;
        removeError = removeError ||
          `downloads.removeFile resolved, but exists=true after ${verificationAttempts} checks`;
      }
    } catch (error) {
      existsAfterRemove = null;
      removeError = removeError || `verification failed: ${String(error)}`;
      removed = false;
    }
    try { await downloads.erase({ id: item.id }); } catch (e) { eraseError = String(e); }
    diagnostics.push({ type: 'download', downloadId: String(item.id), fullPath: String(item.filename || fullPath), stage: 'removeFile', ok: removed, existsAfterRemove, verificationAttempts, error: removeError || '' });
    diagnostics.push({ type: 'download', downloadId: String(item.id), fullPath: String(item.filename || fullPath), stage: 'erase', ok: !eraseError, error: eraseError || '' });
    await trace({
      operationId,
      area: 'reset',
      stage: 'file-delete',
      ok: removed,
      details: {
        requestedDownloadId: downloadId,
        resolvedDownloadId: item.id,
        filename: item.filename || fullPath,
        before: {
          state: item.state || '',
          exists: typeof item.exists === 'boolean' ? item.exists : null,
          error: item.error || ''
        },
        removeError,
        existsAfterRemove,
        verificationAttempts,
        verificationState,
        eraseError
      }
    });
    if (removed) {
      deleted += 1;
      if (contentHash) {
        let released = false;
        let releaseError = '';
        try {
          released = await forgetHash(contentHash);
        } catch (error) {
          releaseError = String(error);
        }
        diagnostics.push({ type: 'registry', downloadId: String(item.id), contentHash, stage: 'forget-duplicate', ok: released, error: releaseError });
        await trace({
          operationId,
          area: 'reset',
          stage: 'registry-release',
          ok: released,
          details: { contentHash, downloadId: String(item.id), error: releaseError }
        });
      }
    } else {
      failed += 1;
    }
  }
  return { deleted, failed, diagnostics };
}
