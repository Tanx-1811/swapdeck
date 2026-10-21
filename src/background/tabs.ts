import { appForUrl, hostMatchesDomain, matchPatterns, parseHttpUrl } from '../core/domains';
import type { AppDef } from '../core/types';
import { SwapdeckError } from '../shared/protocol';

export async function getTab(tabId: number | undefined | null): Promise<chrome.tabs.Tab | null> {
  if (tabId === undefined || tabId === null || tabId < 0) return null;
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

export async function activeTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab ?? null;
}

export function tabUrl(tab: chrome.tabs.Tab | null | undefined): string | null {
  return tab?.url || tab?.pendingUrl || null;
}

/** Normal-window tabs currently showing one of the app's sites. */
export async function queryAppTabs(app: AppDef): Promise<chrome.tabs.Tab[]> {
  const tabs = await chrome.tabs.query({ url: matchPatterns(app) });
  return tabs.filter((tab) => {
    const url = parseHttpUrl(tabUrl(tab));
    return tab.id !== undefined && !tab.incognito && url && app.domains.some((d) => hostMatchesDomain(url.hostname, d));
  });
}

export async function appForTab<T extends AppDef>(apps: readonly T[], tab: chrome.tabs.Tab | null): Promise<T | null> {
  return appForUrl(apps, tabUrl(tab));
}

/**
 * Navigates a tab and resolves once the new page has finished loading.
 * Rejects with TIMEOUT if it never does (e.g. the user kept the page through a
 * "Leave site?" prompt), and NO_TAB if the tab is closed meanwhile.
 */
export function navigateAndWait(tabId: number, url: string, timeoutMs = 20_000): Promise<chrome.tabs.Tab> {
  return new Promise((resolve, reject) => {
    let started = false;
    const timer = setTimeout(() => finish(new SwapdeckError('TIMEOUT', url)), timeoutMs);
    const onUpdated = (id: number, info: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) => {
      if (id !== tabId) return;
      if (info.status === 'loading') started = true;
      if (info.status === 'complete' && started) finish(null, tab);
    };
    const onRemoved = (id: number) => {
      if (id === tabId) finish(new SwapdeckError('NO_TAB'));
    };
    function finish(error: Error | null, tab?: chrome.tabs.Tab) {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      if (error) reject(error);
      else resolve(tab!);
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    chrome.tabs.update(tabId, { url }).catch((error: unknown) => finish(new SwapdeckError('NO_TAB', String(error))));
  });
}

/** Resolves when the tab has finished loading (immediately if it already has). */
export function waitForComplete(tabId: number, timeoutMs = 20_000): Promise<chrome.tabs.Tab> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new SwapdeckError('TIMEOUT')), timeoutMs);
    const onUpdated = (id: number, info: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) => {
      if (id === tabId && info.status === 'complete') finish(null, tab);
    };
    const onRemoved = (id: number) => {
      if (id === tabId) finish(new SwapdeckError('NO_TAB'));
    };
    function finish(error: Error | null, tab?: chrome.tabs.Tab) {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      if (error) reject(error);
      else resolve(tab!);
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    void getTab(tabId).then((tab) => {
      if (!tab) finish(new SwapdeckError('NO_TAB'));
      else if (tab.status === 'complete' && tab.url && tab.url !== 'about:blank') finish(null, tab);
    });
  });
}

/** Runs one of the self-contained functions from page-scripts.ts in the tab's top frame. */
export async function runInTab<Args extends unknown[], Result>(
  tabId: number,
  func: (...args: Args) => Result | Promise<Result>,
  args: Args,
): Promise<Awaited<Result>> {
  let results: chrome.scripting.InjectionResult<Awaited<Result>>[];
  try {
    results = (await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      func,
      args,
    })) as chrome.scripting.InjectionResult<Awaited<Result>>[];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SwapdeckError(/permission|cannot access/i.test(message) ? 'NO_ACCESS' : 'UNKNOWN', message);
  }
  const first = results[0];
  if (!first) throw new SwapdeckError('UNKNOWN', 'No result from the page');
  return first.result as Awaited<Result>;
}
