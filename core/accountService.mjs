export function normalizeFolderPath(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase();
}

export function flattenAccountFolders(folders, out = []) {
  for (const folder of (folders || [])) {
    out.push(folder);
    if (folder.subFolders && folder.subFolders.length) {
      flattenAccountFolders(folder.subFolders, out);
    }
  }
  return out;
}

export function collectScopedRuleFolders(rules) {
  const out = new Map();

  for (const rule of (rules || [])) {
    for (const obj of (rule.folderObjects || [])) {
      const accountId = String(obj.accountId || '');
      const path = normalizeFolderPath(
        obj.path ||
        obj.displayPath ||
        (String(obj.key || '').split('::')[1] || '')
      );

      if (!accountId || !path) continue;
      out.set(`${accountId}::${path}`, { accountId, path });
    }

    if ((!rule.folderObjects || !rule.folderObjects.length) &&
        Array.isArray(rule.folderKeys)) {
      for (const key of rule.folderKeys) {
        const parts = String(key || '').split('::');
        if (parts.length < 2) continue;

        const accountId = String(parts[0] || '');
        const path = normalizeFolderPath(parts.slice(1).join('::'));

        if (!accountId || !path) continue;
        out.set(`${accountId}::${path}`, { accountId, path });
      }
    }
  }

  return [...out.values()];
}

export function folderMatchesExactPath(folder, wantedPath) {
  const variants = [
    folder && folder.path,
    folder && folder.name
  ]
    .map(value => normalizeFolderPath(value || ''))
    .filter(Boolean);

  return variants.includes(normalizeFolderPath(wantedPath || ''));
}

export function ruleAppliesToAccount(rule, accountId, selectedAccountIds = []) {
  const scopedAccounts = Array.isArray(rule && rule.accountIds)
    ? rule.accountIds.map(String).filter(Boolean)
    : [];
  if (scopedAccounts.length) return scopedAccounts.includes(String(accountId));

  const selected = (Array.isArray(selectedAccountIds) ? selectedAccountIds : [])
    .map(String)
    .filter(Boolean);
  return !selected.length || selected.includes(String(accountId));
}

export function ruleHasFolderScope(rule) {
  return Boolean(
    (Array.isArray(rule && rule.folderObjects) && rule.folderObjects.length) ||
    (Array.isArray(rule && rule.folderKeys) && rule.folderKeys.length)
  );
}

export function selectForceExportFolders(
  account,
  rules,
  selectedAccountIds = []
) {
  const accountId = String(account && account.id || '');
  const applicableRules = (Array.isArray(rules) ? rules : [])
    .filter(rule => ruleAppliesToAccount(rule, accountId, selectedAccountIds));
  if (!applicableRules.length) return [];

  const allFolders = flattenAccountFolders(account && account.folders || []);
  if (applicableRules.some(rule => !ruleHasFolderScope(rule))) return allFolders;

  const wantedFolders = collectScopedRuleFolders(applicableRules)
    .filter(item => String(item.accountId) === accountId);
  const result = [];
  const seen = new Set();
  for (const wanted of wantedFolders) {
    const folder = allFolders.find(item => folderMatchesExactPath(item, wanted.path));
    const key = normalizeFolderPath(folder && (folder.path || folder.name) || '');
    if (!folder || seen.has(key)) continue;
    seen.add(key);
    result.push(folder);
  }
  return result;
}
