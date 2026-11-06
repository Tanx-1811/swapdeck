import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prevSnapKey, readState, snapKey } from '../../src/shared/store';
import {
  account,
  APP,
  cookie,
  FakeBrowser,
  sbToken,
  seed,
  seedAcme,
  settle,
  snapshotOf,
  storedSnapshot,
} from './fake-browser';

let browser: FakeBrowser;
let engine: typeof import('../../src/background/engine');

const TOKEN_A = sbToken('u-a', 'a@acme.test');
const TOKEN_B = sbToken('u-b', 'b@acme.test');

beforeEach(async () => {
  vi.resetModules();
  browser = new FakeBrowser();
  browser.install();
  engine = await import('../../src/background/engine');
});

function switchToB(tabId: number) {
  return engine.switchTo({ appId: 'acme', accountId: 'accB', kind: 'switch', tabId });
}

describe('switching', () => {
  it('saves the live session into its account and applies the target, then removes the rule', async () => {
    await seedAcme(browser);
    const tab = browser.addTab('https://acme.test/dashboard');

    await switchToB(tab.id);
    await settle();

    expect(browser.cookie('sid')).toBe('B-session');
    expect(browser.local.get(APP.origin)).toEqual({ 'sb-acme-auth-token': TOKEN_B });
    expect((await storedSnapshot(snapKey('accA')))?.cookies[0]?.value).toBe('A-live');
    expect((await readState()).active.acme).toBe('accB');
    expect(browser.rules).toEqual([]);
    expect(await chrome.storage.session.get('sd:swap')).toEqual({});
  });

  it('blocks scripts and frames on the switching page, in that tab only', async () => {
    await seedAcme(browser);
    const tab = browser.addTab('https://acme.test/dashboard');
    let rules: typeof browser.rules = [];
    browser.scriptHook = (name) => {
      if (name === 'writePageStorage') rules = structuredClone(browser.rules);
      return undefined;
    };

    await switchToB(tab.id);

    expect(rules).toHaveLength(1);
    expect(rules[0]!.condition?.tabIds).toEqual([tab.id]);
    expect(rules[0]!.condition?.resourceTypes).toEqual(['main_frame', 'sub_frame']);
    expect(rules[0]!.action?.responseHeaders?.[0]?.value).toContain("frame-src 'none'");
    expect(rules[0]!.action?.responseHeaders?.[0]?.value).toContain("child-src 'none'");
  });

  it("parks the app's tab that is active in another window during the swap, then sends it back", async () => {
    await seedAcme(browser);
    const here = browser.addTab('https://acme.test/dashboard');
    const other = browser.addTab('https://acme.test/project/x', { windowId: 2 });
    let otherDuringSwap = '';
    browser.scriptHook = (name) => {
      if (name === 'writePageStorage') otherDuringSwap = browser.tabs.get(other.id)!.url;
      return undefined;
    };

    await switchToB(here.id);
    await settle();

    // Its scripts were stopped while the session changed hands…
    expect(otherDuringSwap).toBe('about:blank');
    // …and it came back to its page, with the new session.
    expect(browser.tabs.get(other.id)?.url).toBe('https://acme.test/project/x');
    expect(browser.requests.filter((request) => request.tabId === other.id).at(-1)?.sid).toBe('B-session');
  });

  it('keeps a journal of the swap while it runs, and removes it once done', async () => {
    await seedAcme(browser);
    const tab = browser.addTab('https://acme.test/dashboard');
    let journal: Record<string, unknown> | undefined;
    browser.scriptHook = async (name) => {
      if (name === 'writePageStorage' && !journal) {
        journal = ((await chrome.storage.session.get('sd:swap'))['sd:swap'] as Record<string, unknown>)?.acme as
          Record<string, unknown> | undefined;
      }
      return undefined;
    };

    await switchToB(tab.id);

    expect(journal).toMatchObject({
      appId: 'acme',
      workId: tab.id,
      swapping: true,
      savedInto: 'accA',
      from: 'accA',
      to: 'accB',
      returnUrl: 'https://acme.test/dashboard',
    });
    expect(await chrome.storage.session.get('sd:swap')).toEqual({});
  });
});

describe('re-choosing the account in use (restore), automatic detector', () => {
  const signedOut = () => {
    // The site lost its sign-in (cookies cleared on exit, expired…); the page set an analytics cookie.
    browser.cookies = [];
    browser.setCookie(cookie('_ga', 'GA1.1', { httpOnly: false }));
    browser.local.set(APP.origin, { theme: 'dark' });
  };

  it('puts the saved session back when the site is signed out', async () => {
    await seedAcme(browser);
    signedOut();
    const tab = browser.addTab('https://acme.test/');

    await engine.switchTo({ appId: 'acme', accountId: 'accA', kind: 'switch', tabId: tab.id });
    await settle();

    expect(browser.local.get(APP.origin)).toEqual({ 'sb-acme-auth-token': TOKEN_A });
    expect(browser.cookie('sid')).toBe('A-session');
    // The saved session stays; the signed-out one is only set aside as "previous".
    expect((await storedSnapshot(snapKey('accA')))?.cookies[0]?.value).toBe('A-session');
    expect((await storedSnapshot(prevSnapKey('accA')))?.storage.localStorage).toEqual({ theme: 'dark' });
  });

  it('never loses the saved session through restore-then-switch', async () => {
    await seedAcme(browser);
    signedOut();
    const tab = browser.addTab('https://acme.test/');

    await engine.switchTo({ appId: 'acme', accountId: 'accA', kind: 'switch', tabId: tab.id });
    await settle();
    await switchToB(tab.id);
    await settle();

    const kept = [await storedSnapshot(snapKey('accA')), await storedSnapshot(prevSnapKey('accA'))].some((snap) =>
      snap?.cookies.some((c) => c.value === 'A-session'),
    );
    expect(kept).toBe(true);
  });

  it('keeps the live session as it is when it provably is the account (same person recognised)', async () => {
    await seedAcme(browser);
    const tab = browser.addTab('https://acme.test/');

    await engine.switchTo({ appId: 'acme', accountId: 'accA', kind: 'switch', tabId: tab.id });
    await settle();

    // Newer than the saved copy: kept in the browser and saved into the account.
    expect(browser.cookie('sid')).toBe('A-live');
    expect((await storedSnapshot(snapKey('accA')))?.cookies[0]?.value).toBe('A-live');
  });

  it('keeps someone else recognised as a new account instead of filing them under the account', async () => {
    await seedAcme(browser, { a: { email: undefined, identityId: undefined } });
    browser.local.set(APP.origin, { 'sb-acme-auth-token': sbToken('u-c', 'c@acme.test') });
    const tab = browser.addTab('https://acme.test/');

    const outcome = await engine.switchTo({ appId: 'acme', accountId: 'accA', kind: 'switch', tabId: tab.id });
    await settle();

    expect(outcome.saved?.created).toBe(true);
    expect((await readState()).accounts.find((item) => item.id === outcome.saved?.accountId)?.email).toBe(
      'c@acme.test',
    );
    expect(browser.local.get(APP.origin)).toEqual({ 'sb-acme-auth-token': TOKEN_A });
  });
});

describe('a swap that fails halfway', () => {
  it('the switching tab closed while storage is written: the previous session is put back in a fresh tab', async () => {
    await seedAcme(browser);
    const tab = browser.addTab('https://acme.test/dashboard');
    let writes = 0;
    browser.scriptHook = (name, tabId, args) => {
      if (name !== 'writePageStorage' || writes++ > 0) return undefined;
      const [data] = args as [{ local: Record<string, string> }];
      browser.local.set(APP.origin, { ...data.local });
      browser.closeTab(tabId);
      throw new Error('The tab was closed.');
    };

    await expect(switchToB(tab.id)).rejects.toThrow();
    await settle();

    expect(browser.cookie('sid')).toBe('A-live');
    expect(browser.local.get(APP.origin)).toEqual({ 'sb-acme-auth-token': TOKEN_A });
    const state = await readState();
    expect(state.active.acme).toBe('accA');
    expect(state.history[0]).toMatchObject({ ok: false, toId: 'accB' });
    // The extra tab used to put things back is gone, and so is every rule.
    expect([...browser.tabs.values()]).toEqual([]);
    expect(browser.rules).toEqual([]);
  });

  it('signs the site out (never half one account, half the other) when the session cannot be put back', async () => {
    await seedAcme(browser);
    const tab = browser.addTab('https://acme.test/dashboard');
    let writes = 0;
    browser.scriptHook = (name, tabId, args) => {
      if (name !== 'writePageStorage') return undefined;
      writes++;
      if (writes === 1) {
        const [data] = args as [{ local: Record<string, string> }];
        browser.local.set(APP.origin, { ...data.local });
        browser.closeTab(tabId);
        throw new Error('The tab was closed.');
      }
      // Putting the session back fails in the fresh tab too; clearing the site works.
      if (writes === 3) throw new Error('Frame with ID 0 is showing error page');
      return undefined;
    };

    await expect(switchToB(tab.id)).rejects.toMatchObject({ code: 'ROLLBACK_FAILED' });
    await settle();

    expect(browser.cookie('sid')).toBeUndefined();
    expect(browser.local.get(APP.origin)).toEqual({});
    const state = await readState();
    expect(state.active.acme).toBeNull();
    expect(state.history[0]).toMatchObject({ ok: false, error: 'ROLLBACK_FAILED' });
    // The live session was saved before the swap: nothing is lost.
    expect((await storedSnapshot(snapKey('accA')))?.cookies[0]?.value).toBe('A-live');
  });

  it("never clears or fills another site's storage when the tab moved there mid-switch", async () => {
    await seedAcme(browser);
    browser.local.set('https://globex.test', { draft: 'unsent message', 'globex-auth': 'G-token' });
    const tab = browser.addTab('https://acme.test/dashboard');
    let moved = false;
    browser.scriptHook = (name, tabId) => {
      if (name === 'writePageStorage' && !moved) {
        moved = true;
        browser.tabs.get(tabId)!.url = 'https://globex.test/inbox';
      }
      return undefined;
    };

    await expect(switchToB(tab.id)).rejects.toMatchObject({ code: 'STAGING_FAILED' });
    await settle();

    expect(browser.local.get('https://globex.test')).toEqual({ draft: 'unsent message', 'globex-auth': 'G-token' });
    expect(browser.cookie('sid')).toBe('A-live');
    expect(browser.local.get(APP.origin)).toEqual({ 'sb-acme-auth-token': TOKEN_A });
  });

  it('IndexedDB that could not be replaced fails the switch and puts the previous session back', async () => {
    const idbApp = { ...APP, storage: { ...APP.storage, indexedDB: true } };
    await seedAcme(browser, { app: idbApp });
    const tab = browser.addTab('https://acme.test/');
    let writes = 0;
    browser.scriptHook = (name, _tabId, args) => {
      if (name !== 'writePageStorage' || writes++ > 0) return undefined;
      const [data] = args as [{ local: Record<string, string> }];
      browser.local.set(APP.origin, { ...data.local });
      return { origin: APP.origin, errors: ['IndexedDB app-db: blocked by another open tab'], idbFailed: true };
    };

    await expect(switchToB(tab.id)).rejects.toMatchObject({ code: 'STORAGE_BLOCKED' });
    await settle();

    expect(browser.cookie('sid')).toBe('A-live');
    expect(browser.local.get(APP.origin)).toEqual({ 'sb-acme-auth-token': TOKEN_A });
    const state = await readState();
    expect(state.active.acme).toBe('accA');
    expect(state.history[0]).toMatchObject({ ok: false, error: 'STORAGE_BLOCKED' });
  });
});

describe('apps that swap sessionStorage (one per tab)', () => {
  const SS_APP = { ...APP, storage: { ...APP.storage, sessionStorage: true } };

  async function seedSessions() {
    await seed({
      apps: [SS_APP],
      accounts: [
        account('accA', { email: 'a@acme.test', identityId: 'u-a', capturedAt: 1 }),
        account('accB', { email: 'b@acme.test', identityId: 'u-b', capturedAt: 1, order: 1 }),
      ],
      active: { acme: 'accA' },
      snapshots: {
        accA: snapshotOf([cookie('sid', 'A')], { 'sb-acme-auth-token': TOKEN_A }, { ss: 'A' }),
        accB: snapshotOf([cookie('sid', 'B')], { 'sb-acme-auth-token': TOKEN_B }, { ss: 'B' }),
      },
    });
    browser.setCookie(cookie('sid', 'A'));
    browser.local.set(APP.origin, { 'sb-acme-auth-token': TOKEN_A });
  }

  it("gives every open tab of the app the new account's sessionStorage", async () => {
    await seedSessions();
    const work = browser.addTab('https://acme.test/one');
    const inactive = browser.addTab('https://acme.test/two', { active: false });
    const discarded = browser.addTab('https://acme.test/three', { active: false, discarded: true });
    const otherWindow = browser.addTab('https://acme.test/four', { windowId: 2 });
    for (const tab of [work, inactive, discarded, otherWindow]) {
      browser.session.set(`${tab.id}|${APP.origin}`, { ss: 'A' });
    }

    await engine.switchTo({ appId: 'acme', accountId: 'accB', kind: 'switch', tabId: work.id });
    await settle(100);

    for (const tab of [work, inactive, discarded, otherWindow]) {
      expect(browser.session.get(`${tab.id}|${APP.origin}`)).toEqual({ ss: 'B' });
    }
    expect(browser.tabs.get(inactive.id)?.url).toBe('https://acme.test/two');
    expect(browser.tabs.get(otherWindow.id)?.url).toBe('https://acme.test/four');
  });

  it("never refreshes the saved session from a tab whose sessionStorage isn't the account's", async () => {
    await seedSessions();
    const work = browser.addTab('https://acme.test/one');
    browser.session.set(`${work.id}|${APP.origin}`, { ss: 'A' });
    const watcher = await import('../../src/background/watcher');
    browser.updated.add((tabId, info, tab) => {
      void watcher.onTabUpdated(tabId as number, info as chrome.tabs.OnUpdatedInfo, tab as chrome.tabs.Tab);
    });
    await engine.switchTo({ appId: 'acme', accountId: 'accB', kind: 'switch', tabId: work.id });
    await settle(200);

    // Later, a tab with other sessionStorage loads (auto-sync is due again).
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 120_000);
    const stray = browser.addTab('https://acme.test/elsewhere', { active: false });
    browser.session.set(`${stray.id}|${APP.origin}`, { ss: 'leftover' });
    browser.navigate(stray.id, 'https://acme.test/elsewhere');
    await settle(200);

    expect((await storedSnapshot(snapKey('accB')))?.storage.sessionStorage).toEqual({ ss: 'B' });
  });
});

describe('a swap interrupted by the worker stopping (journal in session storage)', () => {
  async function interrupted(journal: Record<string, unknown>) {
    await chrome.storage.session.set({ 'sd:swap': { acme: journal } });
  }

  it('puts the session saved just before the swap back and returns the tabs', async () => {
    await seedAcme(browser);
    // Half switched: B's cookies, A's local storage; the work tab on the switching page, another tab parked.
    browser.cookies = [];
    browser.setCookie(cookie('sid', 'B-session'));
    const work = browser.addTab('https://acme.test/robots.txt');
    const parked = browser.addTab('about:blank', { windowId: 2 });
    browser.rules = [{ id: 1000 }];
    await interrupted({
      appId: 'acme',
      workId: work.id,
      parked: [{ id: parked.id, url: 'https://acme.test/project/x' }],
      returnUrl: 'https://acme.test/dashboard',
      ownTab: false,
      from: 'accA',
      to: 'accB',
      kind: 'switch',
      swapping: true,
      savedInto: 'accA',
      at: Date.now(),
    });

    const guard = await import('../../src/background/guard');
    await guard.clearStaleRules();
    await engine.recoverInterruptedSwaps();
    await settle();

    expect(browser.cookie('sid')).toBe('A-session');
    expect(browser.local.get(APP.origin)).toEqual({ 'sb-acme-auth-token': TOKEN_A });
    expect(browser.tabs.get(work.id)?.url).toBe('https://acme.test/dashboard');
    expect(browser.tabs.get(parked.id)?.url).toBe('https://acme.test/project/x');
    const state = await readState();
    expect(state.active.acme).toBe('accA');
    expect(state.history[0]).toMatchObject({ ok: false, error: 'INTERRUPTED', fromId: 'accA', toId: 'accB' });
    expect(browser.rules).toEqual([]);
    expect(await chrome.storage.session.get('sd:swap')).toEqual({});
  });

  it('signs the site out when the session before the swap cannot be loaded', async () => {
    await seedAcme(browser);
    browser.setCookie(cookie('sid', 'B-session'));
    const work = browser.addTab('https://acme.test/robots.txt');
    await interrupted({
      appId: 'acme',
      workId: work.id,
      parked: [],
      returnUrl: null,
      ownTab: true,
      from: 'accA',
      to: 'accB',
      kind: 'switch',
      swapping: true,
      savedInto: 'gone',
      at: Date.now(),
    });

    await engine.recoverInterruptedSwaps();
    await settle();

    expect(browser.cookie('sid')).toBeUndefined();
    expect(browser.local.get(APP.origin)).toEqual({});
    expect(browser.tabs.has(work.id)).toBe(false);
    const state = await readState();
    expect(state.active.acme).toBeNull();
    expect(state.history[0]).toMatchObject({ ok: false, error: 'ROLLBACK_FAILED' });
  });

  it('only tidies the tabs when the swap had finished', async () => {
    await seedAcme(browser);
    await chrome.storage.local.set({ 'sd:active': { acme: 'accB' } });
    const parked = browser.addTab('about:blank', { windowId: 2 });
    await interrupted({
      appId: 'acme',
      workId: 999,
      parked: [{ id: parked.id, url: 'https://acme.test/x' }],
      returnUrl: null,
      ownTab: false,
      from: 'accA',
      to: 'accB',
      kind: 'switch',
      swapping: true,
      savedInto: 'accA',
      at: Date.now(),
    });

    await engine.recoverInterruptedSwaps();
    await settle();

    expect(browser.cookie('sid')).toBe('A-live');
    expect(browser.tabs.get(parked.id)?.url).toBe('https://acme.test/x');
    expect((await readState()).history).toEqual([]);
  });

  it('leaves the rules of a switch running in this worker alone when clearing stale ones', async () => {
    const guard = await import('../../src/background/guard');
    browser.rules = [{ id: 5 }];
    const own = await guard.blockPageScripts(1, ['acme.test']);
    await guard.clearStaleRules();
    expect(browser.rules.map((rule) => rule.id)).toEqual([own]);
  });
});
