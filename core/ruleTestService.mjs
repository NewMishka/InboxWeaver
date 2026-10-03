import { parseQuery } from '../modules/queryParser.mjs';
import { describeRuleMatch } from '../modules/queryMatcher.mjs';
import { flattenAccountFolders } from './accountService.mjs';
import { filterRulesForMessage } from './ruleEngine.mjs';

export function createRuleTestService({
  messenger,
  getRules,
  getMessageData,
  logRuleTest
}) {
  async function testRules(params) {
    const accountId = String((params && params.accountId) || '');
    const count = Math.max(1, Math.min(50, Number((params && params.count) || 5)));
    const rules = await getRules();
    const accounts = await messenger.accounts.list();
    const account = (accounts || []).find(item => String(item.id) === accountId) ||
      (accounts || [])[0];
    if (!account) return { error: 'Ящик не найден', messages: [] };

    let headers = [];
    for (const folder of flattenAccountFolders(account.folders || [])) {
      let page;
      try {
        page = await messenger.messages.list(folder);
      } catch (_) {
        continue;
      }
      let pageCount = 0;
      while (page && pageCount < 20) {
        headers.push(...(page.messages || []));
        if (!page.id) break;
        try {
          page = await messenger.messages.continueList(page.id);
        } catch (_) {
          break;
        }
        pageCount += 1;
        if (headers.length > 500) break;
      }
      if (headers.length > 500) break;
    }

    headers.sort((left, right) => new Date(right.date || 0) - new Date(left.date || 0));
    headers = headers.slice(0, count);
    const results = [];
    for (const header of headers) {
      let attachments = [];
      try {
        attachments = await messenger.messages.listAttachments(header.id);
      } catch (_) {}
      const messageData = await getMessageData(header, attachments);
      const ruleResults = rules.map((rule, index) => {
        let tree;
        try {
          tree = parseQuery(rule.query || '');
        } catch (_) {
          return {
            order: index + 1,
            name: rule.name || '',
            folder: rule.folder || '',
            query: rule.query || '',
            matched: false,
            reason: 'Ошибка разбора запроса'
          };
        }
        if (!filterRulesForMessage([rule], header).length) {
          return {
            order: index + 1,
            name: rule.name || '',
            folder: rule.folder || '',
            query: rule.query || '',
            matched: false,
            reason: 'Правило не применяется к этому ящику/папке'
          };
        }
        const description = describeRuleMatch(tree, messageData);
        return {
          order: index + 1,
          name: rule.name || '',
          folder: rule.folder || '',
          query: rule.queryLabel || rule.query || '',
          matched: description.matched,
          reason: description.reason
        };
      });
      results.push({
        subject: header.subject || 'Без темы',
        sender: header.author || '',
        date: new Date(header.date || Date.now()).toLocaleString(),
        attachments: (attachments || []).map(attachment => attachment.name || ''),
        rules: ruleResults
      });
    }
    await logRuleTest({
      accountName: account.name || account.id,
      messagesChecked: headers.length,
      rulesChecked: rules.length
    });
    return { account: account.name || account.id, messages: results, rulesTotal: rules.length };
  }

  return { testRules };
}
