function matchesValue(fieldValue, searchValue, exact) {
  const haystack = String(fieldValue ?? '').toLowerCase();
  const needle = String(searchValue ?? '').toLowerCase();
  return exact ? haystack === needle : haystack.includes(needle);
}

function getExtension(filename) {
  const dotIdx = String(filename || '').lastIndexOf('.');
  return dotIdx >= 0 ? filename.substring(dotIdx + 1).toLowerCase() : '';
}

function splitFileextValues(value, exact) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return [];
  if (exact && !raw.includes(',')) return [raw];
  return raw.split(',').map(x => x.trim()).filter(Boolean);
}

function matchesFileext(ext, value, exact) {
  const values = splitFileextValues(value, exact);
  if (!values.length) return false;
  if (exact) return values.includes(String(ext || '').toLowerCase());
  return values.some(v => String(ext || '').toLowerCase().includes(v));
}

export function matchesQuery(node, message) {
  if (!node) return true;
  switch (node.type) {
    case 'AND': return matchesQuery(node.left, message) && matchesQuery(node.right, message);
    case 'OR': return matchesQuery(node.left, message) || matchesQuery(node.right, message);
    case 'NOT': return !matchesQuery(node.operand, message);
    case 'TERM': {
      const { field, value, exact } = node;
      if (field === 'fileext') {
        return (message.attachments || []).some(att => matchesFileext(getExtension(att.name), value, exact));
      }
      return matchesValue(message[field] ?? '', value, exact);
    }
    default: return false;
  }
}

function fieldRu(field) {
  switch (field) {
    case 'sender_email': return 'отправитель';
    case 'subject': return 'тема';
    case 'body': return 'текст письма';
    case 'fileext': return 'расширение вложения';
    default: return field;
  }
}

function collectFailReasons(node, message, reasons) {
  if (!node) return true;
  switch (node.type) {
    case 'AND': {
      const l = collectFailReasons(node.left, message, reasons);
      const r = collectFailReasons(node.right, message, reasons);
      return l && r;
    }
    case 'OR': {
      const tmp = [];
      const l = collectFailReasons(node.left, message, tmp);
      const r = collectFailReasons(node.right, message, tmp);
      if (l || r) return true;
      for (const x of tmp) reasons.push(x);
      return false;
    }
    case 'NOT': {
      const ok = !matchesQuery(node.operand, message);
      if (!ok) {
        const { field, value } = node.operand && node.operand.type === 'TERM' ? node.operand : {};
        if (field !== undefined) reasons.push(`не должно содержать ${fieldRu(field)}: «${value}», но содержит`);
        else reasons.push('условие исключения сработало');
      }
      return ok;
    }
    case 'TERM': {
      const ok = matchesQuery(node, message);
      if (!ok) {
        const { field, value } = node;
        reasons.push(`не совпал(о) ${fieldRu(field)}: «${value}»`);
      }
      return ok;
    }
    default: return false;
  }
}

export function describeRuleMatch(node, message) {
  if (!node) return { matched: true, reason: 'Пустое правило — совпадает всегда' };
  const reasons = [];
  const matched = collectFailReasons(node, message, reasons);
  return { matched, reason: matched ? '' : (reasons.length ? reasons.join('; ') : 'условие не выполнено') };
}

export function matchesAttachmentQuery(node, message, attachment) {
  if (!node) return true;
  switch (node.type) {
    case 'AND': return matchesAttachmentQuery(node.left, message, attachment) && matchesAttachmentQuery(node.right, message, attachment);
    case 'OR': return matchesAttachmentQuery(node.left, message, attachment) || matchesAttachmentQuery(node.right, message, attachment);
    case 'NOT': return !matchesAttachmentQuery(node.operand, message, attachment);
    case 'TERM': {
      const { field, value, exact } = node;
      if (field === 'fileext') return matchesFileext(getExtension(attachment && attachment.name || ''), value, exact);
      return matchesValue(message[field] ?? '', value, exact);
    }
    default: return false;
  }
}
