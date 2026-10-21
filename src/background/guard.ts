/**
 * While a switch runs, the tab doing the swap shows a plain page of the site
 * (robots.txt by default). If that page turns out to be the app itself (some
 * sites answer every path with their app), its scripts could read or write the
 * session mid-swap. A session rule adds a script-blocking Content-Security-Policy
 * to page loads in that one tab, for as long as the swap takes.
 */
const FIRST_RULE_ID = 1000;
let nextRuleId = FIRST_RULE_ID;

export async function blockPageScripts(tabId: number, domains: readonly string[]): Promise<number> {
  const existing = await chrome.declarativeNetRequest.getSessionRules();
  nextRuleId = Math.max(nextRuleId, ...existing.map((rule) => rule.id + 1));
  const id = nextRuleId++;
  await chrome.declarativeNetRequest.updateSessionRules({
    addRules: [
      {
        id,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          responseHeaders: [
            {
              header: 'content-security-policy',
              operation: 'set',
              value: "script-src 'none'; object-src 'none'; worker-src 'none'",
            },
          ],
        },
        condition: { tabIds: [tabId], resourceTypes: ['main_frame'], requestDomains: [...domains] },
      },
    ],
  });
  return id;
}

export async function unblockPageScripts(ruleId: number): Promise<void> {
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] }).catch(() => undefined);
}

/** Rules left behind by a switch interrupted when the worker stopped. */
export async function clearStaleRules(): Promise<void> {
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  if (rules.length) {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: rules.map((rule) => rule.id) });
  }
}
