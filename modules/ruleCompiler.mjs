import { parseQuery } from './queryParser.mjs';

function collectDependencies(node, fields = new Set()) {
  if (!node) return fields;
  if (node.type === 'TERM') {
    fields.add(String(node.field || ''));
    return fields;
  }
  if (node.operand) collectDependencies(node.operand, fields);
  if (node.left) collectDependencies(node.left, fields);
  if (node.right) collectDependencies(node.right, fields);
  return fields;
}

export function compileRules(rules = []) {
  return (Array.isArray(rules) ? rules : []).map(rule => {
    try {
      const tree = parseQuery(rule && rule.query || '');
      const fields = collectDependencies(tree);
      return {
        rule,
        tree,
        valid: true,
        needsBody: fields.has('body'),
        needsAttachments: fields.has('fileext')
      };
    } catch (error) {
      return {
        rule,
        tree: null,
        valid: false,
        error: String(error),
        needsBody: false,
        needsAttachments: false
      };
    }
  });
}
