export function extractEmail(author) {
  if (!author) return '';
  const match = String(author).match(/<([^>]+)>/);
  return match ? match[1] : String(author).trim();
}

export function extractName(author) {
  if (!author) return '';
  const s = String(author).trim();
  const match = s.match(/^(.*)\s<[^>]+>$/);
  return match ? match[1].trim().replace(/^"|"$/g, '') : s;
}

export function sanitizePathPart(value) {
  return String(value || '')
    .replace(/[<>:"|?*\x00-\x1F]/g, '_')
    .replace(/[\\/]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/g, '')
    .slice(0, 180) || 'item';
}

export function extractBodyText(messagePart) {
  if (!messagePart) return '';

  function stripHtml(html) {
    return String(html || '')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/\s+\n/g, '\n')
      .replace(/\n\s+/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .trim();
  }

  function walk(part) {
    if (!part) return '';

    if (part.parts && part.parts.length) {
      for (const p of part.parts) {
        const text = walk(p);
        if (text) return text;
      }
    }

    const type = String(part.contentType || '').toLowerCase();
    if (type.startsWith('text/plain') && part.body) return String(part.body).trim();
    if (type.startsWith('text/html') && part.body) return stripHtml(part.body);

    if (part.body) {
      const body = String(part.body);
      if (/<[a-z][\s\S]*>/i.test(body)) return stripHtml(body);
      return body.trim();
    }

    return '';
  }

  return walk(messagePart);
}

function normalizeFolderPath(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase();
}

export async function listAccounts() {
  const accounts = await messenger.accounts.list();
  return (accounts || []).map(acc => ({
    id: String(acc.id),
    name: acc.name || String(acc.id),
    folders: acc.folders || []
  }));
}

function flattenFolders(account, folders, parentPath = '') {
  const out = [];
  for (const folder of (folders || [])) {
    const rawPath = folder.path || '';
    const fullPath = rawPath || parentPath || '';

    // Человеческое имя: сначала prettyName/name, path только как запасной вариант
    const humanName = folder.prettyName || folder.name || '';
    const displayPath =
      humanName ||
      fullPath.replace(/^\//, '') ||
      'Без имени';

    out.push({
      accountId: String(account.id),
      accountName: account.name || String(account.id),
      path: fullPath,
      displayPath,
      key: `${String(account.id)}::${normalizeFolderPath(fullPath)}`
    });

    if (folder.subFolders && folder.subFolders.length) {
      out.push(...flattenFolders(account, folder.subFolders, fullPath));
    }
  }
  return out;
}

export async function listFolders() {
  const accounts = await messenger.accounts.list();
  let result = [];
  for (const acc of (accounts || [])) {
    result = result.concat(flattenFolders(acc, acc.folders || []));
  }
  return result;
}