import { normalizeFolderPath } from './accountService.mjs';

export function folderInfoFromHeader(header) {
  const accountId = String(
    (header && header.folder && header.folder.accountId) || ''
  );
  const path = String(
    (header && header.folder && header.folder.path) || ''
  );
  const name = String(
    (header && header.folder && header.folder.name) || ''
  );

  return {
    accountId,
    rawPath: path,
    rawName: name,
    normalizedPath: normalizeFolderPath(path),
    normalizedName: normalizeFolderPath(name)
  };
}

export function folderCandidateMatches(candidateFolder, info) {
  if (!candidateFolder) return false;

  const folder = normalizeFolderPath(candidateFolder);
  if (!folder) return true;

  const variants = [
    info && info.normalizedPath,
    info && info.normalizedName
  ].filter(Boolean);

  return variants.some(value => value === folder);
}

export function folderRuleMatches(rule, header) {
  const info = folderInfoFromHeader(header);
  const messageAccountId = info.accountId;

  if (
    rule.accountIds &&
    rule.accountIds.length &&
    !rule.accountIds.map(String).includes(String(messageAccountId))
  ) {
    return false;
  }

  const folderObjects = Array.isArray(rule.folderObjects)
    ? rule.folderObjects
    : [];

  if (folderObjects.length) {
    return folderObjects.some(obj =>
      String(obj.accountId || '') === String(messageAccountId) &&
      (
        folderCandidateMatches(obj.path || '', info) ||
        folderCandidateMatches(obj.displayPath || '', info) ||
        folderCandidateMatches(
          (obj.key || '').split('::')[1] || '',
          info
        )
      )
    );
  }

  if (rule.folderKeys && rule.folderKeys.length) {
    const matched = rule.folderKeys.map(String).some(key => {
      if (!key.includes('::')) return false;

      const [accountId, rawFolder] = key.split('::');
      if (String(accountId) !== String(messageAccountId)) return false;

      return folderCandidateMatches(rawFolder, info);
    });

    if (!matched) return false;
  }

  return true;
}

export function filterRulesForMessage(rules, header) {
  return (rules || []).filter(rule => folderRuleMatches(rule, header));
}
