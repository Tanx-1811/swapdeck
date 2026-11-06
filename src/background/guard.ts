/**
 * While a switch runs, the tab doing the swap shows a plain page of the site
 * (robots.txt by default). If that page turns out to be the app itself (some
 * sites answer every path with their app), its scripts could read or write the
 * session mid-swap. A session rule adds a script-blocking Content-Security-Policy
 * to page loads in that tab (and in the app's other tabs parked on the same
 * page), for as long as the swap takes.
 */
const FIRST_RULE_ID = 1000;
let nextRuleId = FIRST_RULE_ID;
/** Rules added by this run of the worker (a switch still needs them). */
const ownRules = new Set<number>();

/** No page script, plug-in, worker or frame may run on the switching page. */
export const SWAP_CSP = "script-src 'none'; object-src 'none'; worker-src 'none'; frame-src 'none'; child-src 'none'";

export async function blockPageScripts(
  tabIds: number | readonly number[],
  domains: readonly string[],
): Promise<number> {
  const existing = await chrome.declarativeNetRequest.getSessionRules();
  nextRuleId = Math.max(nextRuleId, ...existing.map((rule) => rule.id + 1));
  const id = nextRuleId++;
  ownRules.add(id);
  await chrome.declarativeNetRequest.updateSessionRules({
    addRules: [
      {
        id,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          responseHeaders: [{ header: 'content-security-policy', operation: 'set', value: SWAP_CSP }],
        },
        condition: {
          tabIds: typeof tabIds === 'number' ? [tabIds] : [...tabIds],
          // Frames too: a same-origin frame on the switching page would otherwise run the site's scripts.
          resourceTypes: ['main_frame', 'sub_frame'],
          requestDomains: [...domains],
        },
      },
    ],
  });
  return id;
}

export async function unblockPageScripts(ruleId: number): Promise<void> {
  ownRules.delete(ruleId);
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] }).catch(() => undefined);
}

/** Rules left behind by a switch interrupted when the worker stopped (not those of a switch running now). */
export async function clearStaleRules(): Promise<void> {
  const stale = (await chrome.declarativeNetRequest.getSessionRules())
    .map((rule) => rule.id)
    .filter((id) => !ownRules.has(id));
  if (stale.length) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: stale });
}
