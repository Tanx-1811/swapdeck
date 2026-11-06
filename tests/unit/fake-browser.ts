/*
 * A small fake browser for driving the switching engine, the watcher and the
 * guarded paths in unit tests: tabs with navigation events, the cookie jar,
 * localStorage per origin, sessionStorage per tab, declarativeNetRequest
 * session rules, context menus, and chrome.scripting.executeScript, which runs
 * a fake of each page-script function (by name) against that state — the same
 * way the real functions in src/background/page-scripts.ts behave.
 */
import { vi } from 'vitest';
import type { Account, AppDef, CookieRecord, Snapshot } from '../../src/core/types';
import { KEYS, snapKey } from '../../src/shared/store';

export type FakeTab = {
  id: number;
  windowId: number;
  index: number;
  url: string;
  title: string;
  active: boolean;
  discarded: boolean;
  status: 'loading' | 'complete';
  incognito: false;
};

type Listener = (...args: unknown[]) => void;

/**
 * Runs before each fake page script. Throw to make the injection fail (tab
 * closed, error page), return a value to use as the script's result, or return
 * a promise that never settles to make the page hang.
 */
export type ScriptHook = (name: string, tabId: number, args: unknown[]) => unknown;

type DnrRule = {
  id: number;
  action?: { responseHeaders?: { value?: string }[] };
  condition?: { tabIds?: number[]; resourceTypes?: string[] };
};

export class FakeBrowser {
  tabs = new Map<number, FakeTab>();
  nextTabId = 1;
  focusedWindow = 1;
  cookies: chrome.cookies.Cookie[] = [];
  local = new Map<string, Record<string, string>>();
  session = new Map<string, Record<string, string>>();
  rules: DnrRule[] = [];
  updated = new Set<Listener>();
  removed = new Set<Listener>();
  scriptHook: ScriptHook | null = null;
  /** Every page script run: its name and tab. */
  scripts: { name: string; tabId: number; args: unknown[] }[] = [];
  /** Every page request: which session cookie ("sid") the browser sent with it. */
  requests: { tabId: number; url: string; sid: string | undefined }[] = [];
  /** Page titles by URL, for recent items. */
  titles = new Map<string, string>();
  /** How many times the context menus were rebuilt (chrome.contextMenus.removeAll calls). */
  menuRebuilds = 0;

  originOf(url: string): string {
    try {
      const parsed = new URL(url);
      return parsed.protocol.startsWith('http') ? parsed.origin : 'null';
    } catch {
      return 'null';
    }
  }

  addTab(url: string, options: { active?: boolean; windowId?: number; discarded?: boolean } = {}): FakeTab {
    const windowId = options.windowId ?? this.focusedWindow;
    const tab: FakeTab = {
      id: this.nextTabId++,
      windowId,
      index: [...this.tabs.values()].filter((item) => item.windowId === windowId).length,
      url,
      title: this.titles.get(url) ?? url,
      active: options.active ?? true,
      discarded: options.discarded ?? false,
      status: 'complete',
      incognito: false,
    };
    if (tab.active) for (const other of this.tabs.values()) if (other.windowId === windowId) other.active = false;
    this.tabs.set(tab.id, tab);
    return tab;
  }

  private emit(set: Set<Listener>, ...args: unknown[]) {
    for (const listener of [...set]) listener(...args);
  }

  navigate(tabId: number, url: string): void {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    if (url.startsWith('http')) {
      this.requests.push({ tabId, url, sid: this.cookies.find((c) => c.name === 'sid')?.value });
    }
    tab.url = url;
    tab.title = this.titles.get(url) ?? url;
    tab.status = 'loading';
    tab.discarded = false;
    setTimeout(() => {
      if (!this.tabs.has(tabId) || tab.url !== url) return;
      this.emit(this.updated, tabId, { status: 'loading', url }, { ...tab });
      setTimeout(() => {
        if (!this.tabs.has(tabId) || tab.url !== url) return;
        tab.status = 'complete';
        this.emit(this.updated, tabId, { status: 'complete' }, { ...tab });
      }, 1);
    }, 1);
  }

  closeTab(tabId: number): void {
    if (!this.tabs.delete(tabId)) return;
    setTimeout(() => this.emit(this.removed, tabId, {}), 0);
  }

  cookie(name: string): string | undefined {
    return this.cookies.find((item) => item.name === name)?.value;
  }

  cookieMatches(cookie: chrome.cookies.Cookie, domain: string): boolean {
    const d = cookie.domain.replace(/^\./, '');
    return d === domain || d.endsWith(`.${domain}`);
  }

  setCookie(record: CookieRecord): void {
    this.cookies = this.cookies.filter(
      (item) => !(item.name === record.name && item.domain === record.domain && item.path === record.path),
    );
    this.cookies.push({ ...record, storeId: '0' } as chrome.cookies.Cookie);
  }

  /** The fake of a page script: what the real one does to the page the tab shows. */
  private runScript(name: string, tab: FakeTab, args: unknown[]): unknown {
    const origin = this.originOf(tab.url);
    const sessionKey = `${tab.id}|${origin}`;
    switch (name) {
      case 'readPageStorage': {
        const options = args[0] as { local: boolean; session: boolean; idb: boolean; expectedOrigin?: string };
        const base = { origin, href: tab.url, title: tab.title, contentType: 'text/plain' };
        if (options.expectedOrigin && origin !== options.expectedOrigin) return base;
        return {
          ...base,
          ...(options.local ? { local: { ...(this.local.get(origin) ?? {}) } } : {}),
          ...(options.session ? { session: { ...(this.session.get(sessionKey) ?? {}) } } : {}),
          ...(options.idb ? { idb: [] } : {}),
        };
      }
      case 'writePageStorage': {
        const [data, options] = args as [
          { local?: Record<string, string>; session?: Record<string, string> },
          { local: boolean; session: boolean; expectedOrigin?: string },
        ];
        if (options.expectedOrigin && origin !== options.expectedOrigin) return { origin, errors: [] };
        if (options.local) this.local.set(origin, { ...(data.local ?? {}) });
        if (options.session) this.session.set(sessionKey, { ...(data.session ?? {}) });
        return { origin, errors: [] };
      }
      case 'probePage':
        return { origin, href: tab.url, contentType: 'text/plain' };
      case 'askOnPage':
        return true;
      case 'askLinkOnPage':
        return 'switch';
      case 'unsavedWork':
        return { dirty: false, reason: null };
      default:
        return undefined;
    }
  }

  install(): void {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const browser = this;
    const tabCopy = (tab: FakeTab) => ({ ...tab }) as unknown as chrome.tabs.Tab;
    const hostMatches = (url: string, patterns: string[]) => {
      let host: string;
      try {
        host = new URL(url).hostname;
      } catch {
        return false;
      }
      return patterns.some((pattern) => {
        const match = /^\*:\/\/(\*\.)?([^/]+)\/\*$/.exec(pattern);
        if (!match) return false;
        const domain = match[2]!;
        return host === domain || (Boolean(match[1]) && host.endsWith(`.${domain}`));
      });
    };
    const scripting = {
      executeScript: vi.fn(
        async (injection: { target: { tabId: number }; func: { name: string }; args?: unknown[] }) => {
          const tabId = injection.target.tabId;
          const name = injection.func.name;
          const args = injection.args ?? [];
          browser.scripts.push({ name, tabId, args });
          await new Promise((resolve) => setTimeout(resolve, 0));
          if (browser.scriptHook) {
            const replaced = await browser.scriptHook(name, tabId, args);
            if (replaced !== undefined) return [{ frameId: 0, result: replaced }];
          }
          const tab = browser.tabs.get(tabId);
          if (!tab) throw new Error(`No tab with id: ${tabId}.`);
          return [{ frameId: 0, result: browser.runScript(name, tab, args) }];
        },
      ),
    };
    const tabs = {
      query: vi.fn(async (query: { url?: string[]; active?: boolean; lastFocusedWindow?: boolean }) => {
        let list = [...browser.tabs.values()];
        if (query.url) list = list.filter((tab) => hostMatches(tab.url, query.url!));
        if (query.active) list = list.filter((tab) => tab.active);
        if (query.lastFocusedWindow) list = list.filter((tab) => tab.windowId === browser.focusedWindow);
        return list.map(tabCopy);
      }),
      get: vi.fn(async (id: number) => {
        const tab = browser.tabs.get(id);
        if (!tab) throw new Error(`No tab with id: ${id}.`);
        return tabCopy(tab);
      }),
      create: vi.fn(async (props: { url?: string; active?: boolean; windowId?: number }) => {
        const url = props.url ?? 'about:blank';
        const tab = browser.addTab('about:blank', { active: props.active ?? true, windowId: props.windowId });
        if (url !== 'about:blank') browser.navigate(tab.id, url);
        return tabCopy(tab);
      }),
      update: vi.fn(async (id: number, props: { url?: string; active?: boolean }) => {
        const tab = browser.tabs.get(id);
        if (!tab) throw new Error(`No tab with id: ${id}.`);
        if (props.active) {
          for (const other of browser.tabs.values()) if (other.windowId === tab.windowId) other.active = false;
          tab.active = true;
        }
        if (props.url) browser.navigate(id, props.url);
        return tabCopy(tab);
      }),
      remove: vi.fn(async (id: number) => {
        if (!browser.tabs.has(id)) throw new Error(`No tab with id: ${id}.`);
        browser.closeTab(id);
      }),
      discard: vi.fn(async (id: number) => {
        const tab = browser.tabs.get(id);
        if (!tab || tab.active) throw new Error('Cannot discard');
        tab.discarded = true;
        return tabCopy(tab);
      }),
      reload: vi.fn(async (id: number) => {
        const tab = browser.tabs.get(id);
        if (tab) browser.navigate(id, tab.url);
      }),
      group: vi.fn(async () => 1),
      onUpdated: {
        addListener: (fn: Listener) => browser.updated.add(fn),
        removeListener: (fn: Listener) => browser.updated.delete(fn),
      },
      onRemoved: {
        addListener: (fn: Listener) => browser.removed.add(fn),
        removeListener: (fn: Listener) => browser.removed.delete(fn),
      },
    };
    const cookies = {
      getAll: vi.fn(async (filter: { domain: string }) =>
        browser.cookies.filter((cookie) => browser.cookieMatches(cookie, filter.domain)).map((c) => ({ ...c })),
      ),
      set: vi.fn(async (details: chrome.cookies.SetDetails) => {
        const host = new URL(details.url).hostname;
        const record: CookieRecord = {
          name: details.name ?? '',
          value: details.value ?? '',
          domain: details.domain ? (details.domain.startsWith('.') ? details.domain : `.${details.domain}`) : host,
          path: details.path ?? '/',
          secure: details.secure ?? false,
          httpOnly: details.httpOnly ?? false,
          hostOnly: !details.domain,
          session: details.expirationDate === undefined,
          sameSite: (details.sameSite as CookieRecord['sameSite']) ?? 'unspecified',
          ...(details.expirationDate !== undefined ? { expirationDate: details.expirationDate } : {}),
        };
        browser.setCookie(record);
        return { ...record } as chrome.cookies.Cookie;
      }),
      remove: vi.fn(async (details: { url: string; name: string }) => {
        const host = new URL(details.url).hostname;
        browser.cookies = browser.cookies.filter((cookie) => {
          if (cookie.name !== details.name) return true;
          const d = cookie.domain.replace(/^\./, '');
          const sent = cookie.hostOnly ? d === host : host === d || host.endsWith(`.${d}`);
          return !sent;
        });
        return { url: details.url, name: details.name, storeId: '0' };
      }),
    };
    const declarativeNetRequest = {
      getSessionRules: vi.fn(async () => browser.rules.map((rule) => ({ ...rule }))),
      updateSessionRules: vi.fn(async (options: { addRules?: DnrRule[]; removeRuleIds?: number[] }) => {
        browser.rules = browser.rules.filter((rule) => !options.removeRuleIds?.includes(rule.id));
        browser.rules.push(...(options.addRules ?? []).map((rule) => structuredClone(rule)));
      }),
    };
    Object.assign(globalThis.chrome, {
      tabs,
      cookies,
      scripting,
      declarativeNetRequest,
      windows: {
        update: vi.fn(async () => ({})),
        create: vi.fn(async () => ({ id: 99 })),
        getLastFocused: vi.fn(async () => ({ id: browser.focusedWindow })),
      },
      tabGroups: { update: vi.fn(async () => ({})) },
      contextMenus: {
        removeAll: vi.fn(async () => {
          browser.menuRebuilds++;
        }),
        create: vi.fn(() => undefined),
      },
      action: {
        setBadgeText: vi.fn(async () => undefined),
        setBadgeBackgroundColor: vi.fn(async () => undefined),
        setBadgeTextColor: vi.fn(async () => undefined),
        setTitle: vi.fn(async () => undefined),
      },
    });
  }
}

/** Lets timers and promises run for a while (real timers). */
export async function settle(ms = 60): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Waits until `check` holds (or fails the test after `ms`). */
export async function until(check: () => boolean | Promise<boolean>, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('Timed out waiting for a condition');
    await settle(10);
  }
}

export const APP: AppDef = {
  id: 'acme',
  name: 'Acme',
  color: '#e8590c',
  domains: ['acme.test'],
  origin: 'https://acme.test',
  homeUrl: 'https://acme.test/',
  stagingPath: '/robots.txt',
  storage: { cookies: true, localStorage: true, sessionStorage: false, indexedDB: false },
  detector: { kind: 'auto' },
  order: 0,
  createdAt: 1,
};

/** A supabase-js style session for a user, recognised by the automatic detector (strong). */
export function sbToken(id: string, email: string): string {
  return JSON.stringify({ access_token: 'x', refresh_token: `rt-${id}`, user: { id, email } });
}

export function cookie(name: string, value: string, extra: Partial<CookieRecord> = {}): CookieRecord {
  return {
    name,
    value,
    domain: 'acme.test',
    path: '/',
    secure: true,
    httpOnly: true,
    hostOnly: true,
    session: false,
    sameSite: 'lax',
    expirationDate: Date.now() / 1000 + 86_400 * 30,
    ...extra,
  };
}

export function snapshotOf(
  cookies: CookieRecord[],
  local: Record<string, string>,
  session?: Record<string, string>,
): Snapshot {
  return {
    v: 1,
    capturedAt: Date.now() - 60_000,
    origin: APP.origin,
    cookies,
    storage: { localStorage: local, ...(session ? { sessionStorage: session } : {}) },
  };
}

export function account(id: string, extra: Partial<Account> = {}): Account {
  return {
    id,
    appId: APP.id,
    label: id,
    color: '#6d4cff',
    pins: [],
    recents: [],
    order: 0,
    createdAt: 1,
    switchCount: 0,
    ...extra,
  };
}

export async function seed(options: {
  apps?: AppDef[];
  accounts: Account[];
  active: Record<string, string | null>;
  snapshots?: Record<string, Snapshot>;
  settings?: Record<string, unknown>;
  workspaces?: unknown[];
}): Promise<void> {
  await chrome.storage.local.set({
    [KEYS.apps]: options.apps ?? [APP],
    [KEYS.accounts]: options.accounts,
    [KEYS.active]: options.active,
    [KEYS.settings]: options.settings ?? {},
    [KEYS.history]: [],
    [KEYS.workspaces]: options.workspaces ?? [],
    ...Object.fromEntries(
      Object.entries(options.snapshots ?? {}).map(([id, snapshot]) => [snapKey(id), { v: 1, plain: snapshot }]),
    ),
  });
}

/** Two accounts of Acme (A in use, B saved), each recognised, and the browser signed in as A. */
export async function seedAcme(
  browser: FakeBrowser,
  options: { app?: AppDef; settings?: Record<string, unknown>; a?: Partial<Account>; b?: Partial<Account> } = {},
): Promise<void> {
  await seed({
    apps: [options.app ?? APP],
    accounts: [
      account('accA', { email: 'a@acme.test', identityId: 'u-a', capturedAt: 1, ...options.a }),
      account('accB', { email: 'b@acme.test', identityId: 'u-b', capturedAt: 1, order: 1, ...options.b }),
    ],
    active: { acme: 'accA' },
    snapshots: {
      accA: snapshotOf([cookie('sid', 'A-session')], { 'sb-acme-auth-token': sbToken('u-a', 'a@acme.test') }),
      accB: snapshotOf([cookie('sid', 'B-session')], { 'sb-acme-auth-token': sbToken('u-b', 'b@acme.test') }),
    },
    ...(options.settings ? { settings: options.settings } : {}),
  });
  browser.setCookie(cookie('sid', 'A-live'));
  browser.local.set(APP.origin, { 'sb-acme-auth-token': sbToken('u-a', 'a@acme.test') });
}

/** Reads a saved (unsealed) snapshot. */
export async function storedSnapshot(key: string): Promise<Snapshot | null> {
  const raw = (await chrome.storage.local.get(key))[key] as { plain?: Snapshot } | undefined;
  return raw?.plain ?? null;
}
