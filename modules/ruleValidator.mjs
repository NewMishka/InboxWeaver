import { parseQuery } from './queryParser.mjs';

function normalizedList(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(String).filter(Boolean))].sort();
}

function ruleSignature(rule) {
  return JSON.stringify({
    query: String(rule.query || '').trim().toLowerCase(),
    accountIds: normalizedList(rule.accountIds),
    folderKeys: normalizedList(rule.folderKeys),
    folder: String(rule.folder || '').trim().toLowerCase()
  });
}

export function validateRuleDefinitions(rules = []) {
  const source = Array.isArray(rules) ? rules : [];
  const signatureCounts = new Map();
  for (const rule of source) {
    const signature = ruleSignature(rule || {});
    signatureCounts.set(signature, (signatureCounts.get(signature) || 0) + 1);
  }

  const results = source.map((ruleValue, index) => {
    const rule = ruleValue && typeof ruleValue === 'object' ? ruleValue : {};
    const errors = [];
    const warnings = [];
    const query = String(rule.query || '').trim();
    const accountIds = normalizedList(rule.accountIds);
    const folderKeys = normalizedList(rule.folderKeys);

    if (!String(rule.name || '').trim()) errors.push('Не указано название');
    if (!query) errors.push('Не задано условие');
    else {
      try { parseQuery(query); }
      catch (error) { errors.push(`Ошибка условия: ${String(error && error.message || error)}`); }
    }
    if (!String(rule.folder || '').trim()) errors.push('Не указана папка результата');
    if (!accountIds.length) errors.push('Не выбран почтовый ящик');
    if (!folderKeys.length) errors.push('Не выбрана папка для сканирования');
    if (rule.enabled === false) warnings.push('Правило выключено');
    if (signatureCounts.get(ruleSignature(rule)) > 1) warnings.push('Найдено другое правило с такими же условиями и областью');

    return {
      index,
      name: String(rule.name || '').trim() || `Правило #${index + 1}`,
      query,
      enabled: rule.enabled !== false,
      valid: errors.length === 0,
      errors,
      warnings
    };
  });

  return {
    total: results.length,
    valid: results.filter(result => result.valid).length,
    invalid: results.filter(result => !result.valid).length,
    warnings: results.reduce((sum, result) => sum + result.warnings.length, 0),
    rules: results
  };
}
