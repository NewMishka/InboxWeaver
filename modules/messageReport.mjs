import { OUTCOME, dateToIso } from './statisticsAggregator.mjs';

function importanceLabel(value) {
  return ({
    high: 'Высокая',
    normal: 'Обычная',
    low: 'Низкая'
  })[String(value || '').toLowerCase()] || 'Не указана';
}

function receivedSortKey(row) {
  return `${dateToIso(row.received_date) || '0000-00-00'} ${String(row.received_time || '').trim()}`;
}

function countMessageIds(messages) {
  const counts = new Map();
  messages.forEach(row => {
    const id = String(row.headerMessageId || '').trim();
    if (!id) return;
    counts.set(id, (counts.get(id) || 0) + 1);
  });
  return counts;
}

const HEADER_LOOKUP_CONCURRENCY = 8;

// Older audit records predate headerMessageId. The temporary Thunderbird id
// is used only to retrieve the RFC Message-ID again; it is never exported.
export async function hydrateMessageHeaderIds(messages, getMessageHeader) {
  const list = Array.isArray(messages) ? messages : [];
  if (typeof getMessageHeader !== 'function') return list;

  const lookups = new Map();
  const lookup = async messageId => {
    const key = String(messageId ?? '').trim();
    if (!key) return '';
    if (!lookups.has(key)) {
      lookups.set(key, Promise.resolve()
        .then(() => getMessageHeader(messageId))
        .then(header => String(header && header.headerMessageId || '').trim())
        .catch(() => ''));
    }
    return await lookups.get(key);
  };

  const hydrated = [...list];
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < list.length) {
      const index = nextIndex++;
      const row = list[index];
      if (String(row && row.headerMessageId || '').trim()) continue;
      const headerMessageId = await lookup(row && row.messageId);
      if (headerMessageId) hydrated[index] = { ...row, headerMessageId };
    }
  };

  await Promise.all(Array.from(
    { length: Math.min(HEADER_LOOKUP_CONCURRENCY, list.length) },
    worker
  ));
  return hydrated;
}

export function messageReportRows(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const idCounts = countMessageIds(list);

  return list
    .map(row => {
      const matchedAttachments = Array.isArray(row.matchedAttachments)
        ? row.matchedAttachments
        : [];
      const hasAttachments = row.outcome !== OUTCOME.NO_ATTACHMENTS;
      const messageId = String(row.headerMessageId || '').trim();

      return {
        message_id: messageId,
        duplicate_message_id: messageId && idCounts.get(messageId) > 1 ? 'yes' : 'no',
        received_date: row.receivedDate || row.checkedDate || '',
        received_time: row.receivedTime || row.checkedTime || '',
        importance: importanceLabel(row.importance),
        mailbox: row.accountName || '',
        sender_name: row.senderName || '',
        sender_email: row.senderEmail || row.sender || '',
        subject: row.subject || '',
        matched_attachments: matchedAttachments
          .map(attachment => attachment.name)
          .filter(Boolean)
          .join('; '),
        availability_of_attachments: hasAttachments ? 'yes' : 'no',
        accepted_for_work: '',
        closure_details: ''
      };
    })
    .sort((a, b) => {
      const keyA = receivedSortKey(a);
      const keyB = receivedSortKey(b);
      return keyB > keyA ? 1 : keyB < keyA ? -1 : 0;
    });
}
