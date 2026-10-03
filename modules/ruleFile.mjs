const FORMAT = 'inbox-weaver-rules';
const FORMAT_VERSION = 1;
const SAVE_MODES = new Set(['combined', 'by_rule', 'by_sender', 'by_account', 'by_date']);

function stringList(value) {
  return Array.isArray(value)
    ? [...new Set(value.map(item => String(item || '').trim()).filter(Boolean))]
    : [];
}

function exportRule(rule = {}) {
  return {
    name: String(rule.name || ''),
    enabled: rule.enabled !== false,
    when: String(rule.query || ''),
    scan: { accounts: stringList(rule.accountIds), folders: stringList(rule.folderKeys) },
    save: {
      folder: String(rule.folder || ''),
      mode: String(rule.saveMode || 'combined'),
      base_path: String(rule.basePath || '')
    }
  };
}

export function ruleFileJson(rules = []) {
  return JSON.stringify({
    format: FORMAT,
    format_version: FORMAT_VERSION,
    rules: (Array.isArray(rules) ? rules : []).map(exportRule)
  }, null, 2) + '\n';
}

function malformed(message) {
  throw new Error(`Файл правил: ${message}`);
}

export function parseRuleFile(text, createId = index => `import-${Date.now()}-${index}`) {
  let source;
  try {
    source = JSON.parse(String(text || ''));
  } catch (_) {
    malformed('не удалось прочитать JSON. Проверьте кавычки, запятые и скобки.');
  }
  if (!source || typeof source !== 'object' || Array.isArray(source)) malformed('ожидается объект верхнего уровня.');
  if (source.format !== FORMAT) malformed(`ожидается поле format со значением "${FORMAT}".`);
  if (source.format_version !== FORMAT_VERSION) malformed(`поддерживается только format_version: ${FORMAT_VERSION}.`);
  if (!Array.isArray(source.rules)) malformed('поле rules должно быть массивом правил.');
  if (source.rules.length > 500) malformed('в одном файле допускается не более 500 правил.');

  return source.rules.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) malformed(`правило №${index + 1} должно быть объектом.`);
    const scan = item.scan && typeof item.scan === 'object' && !Array.isArray(item.scan) ? item.scan : {};
    const save = item.save && typeof item.save === 'object' && !Array.isArray(item.save) ? item.save : {};
    const mode = String(save.mode || 'combined');
    if (!SAVE_MODES.has(mode)) malformed(`у правила №${index + 1} неизвестный save.mode: ${mode}.`);
    return {
      id: String(createId(index)),
      name: String(item.name || '').trim(),
      enabled: item.enabled !== false,
      query: String(item.when || '').trim(),
      queryLabel: String(item.when || '').trim(),
      accountIds: stringList(scan.accounts),
      folderKeys: stringList(scan.folders),
      folderObjects: [],
      folder: String(save.folder || '').trim(),
      saveMode: mode,
      basePath: String(save.base_path || '').trim()
    };
  });
}

export const RULE_FILE_FORMAT = Object.freeze({ FORMAT, FORMAT_VERSION });
