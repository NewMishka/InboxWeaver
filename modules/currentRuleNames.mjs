export function currentRuleNames(rules = []) {
  return [...new Set(
    (Array.isArray(rules) ? rules : [])
      .map(rule => String(rule && rule.name || '').trim())
      .filter(Boolean)
  )].sort((left, right) => left.localeCompare(right, 'ru', {
    sensitivity: 'base',
    numeric: true
  }));
}
