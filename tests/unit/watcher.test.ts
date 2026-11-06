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
  until,
} from './fake-browser';

let browser: FakeBrowser;
let watcher: typeof import('../../src/background/watcher');

const TOKEN_A = sbToken('u-a', 'a@acme.test');
const SUPABASE_LIKE = { ...APP, detector: { kind: 'localStorage' as const, keys: ['sb-*-auth-token'] } };

beforeEach(async () => {
  vi.resetModules();
  browser = new FakeBrowser();
  browser.install();
  watcher = await import('../../src/background/watcher');
});

function loaded(tab: { id: number }) {
  return watcher.onTabUpdated(tab.id, { status: 'complete' }, {
    ...browser.tabs.get(tab.id),
  } as unknown as chrome.tabs.Tab);
}

function wire() {
  browser.updated.add((tabId, info, tab) => {
    void watcher.onTabUpdated(tabId as number, info as chrome.tabs.OnUpdatedInfo, tab as chrome.tabs.Tab);
  });
}

describe('auto-sync of the account in use', () => {
  it('checks who is signed in in the session it saves, not in an earlier look at the page', async () => {
    await seed({
      accounts: [account('accA', { email: 'a@acme.test', identityId: 'u-a', capturedAt: 1 })],
      active: { acme: 'accA' },
      snapshots: { accA: snapshotOf([cookie('sid', 'A')], { 'sb-acme-auth-token': TOKEN_A }) },
    });
    browser.setCookie(cookie('sid', 'A'));
    browser.local.set(APP.origin, { 'sb-acme-auth-token': TOKEN_A });
    const tab = browser.addTab('https://acme.test/');
    // The page finishes signing in as someone else (C) right after the watcher looked.
    let reads = 0;
    browser.scriptHook = (name) => {
      if (name === 'readPageStorage' && ++reads === 2) {
        browser.local.set(APP.origin, { 'sb-acme-auth-token': sbToken('u-c', 'c@acme.test') });
        browser.setCookie(cookie('sid', 'C'));
      }
      return undefined;
    };

    await loaded(tab);
    await settle();

    expect((await storedSnapshot(snapKey('accA')))?.cookies[0]?.value).toBe('A');
  });

  it('refreshes the saved session when it is the same person', async () => {
    await seed({
      accounts: [account('accA', { email: 'a@acme.test', identityId: 'u-a', capturedAt: 1 })],
      active: { acme: 'accA' },
      snapshots: { accA: snapshotOf([cookie('sid', 'A-old')], { 'sb-acme-auth-token': TOKEN_A }) },
    });
    browser.setCookie(cookie('sid', 'A-new'));
    browser.local.set(APP.origin, { 'sb-acme-auth-token': TOKEN_A });
    const tab = browser.addTab('https://acme.test/');

    await loaded(tab);
    await settle();

    expect((await storedSnapshot(snapKey('accA')))?.cookies[0]?.value).toBe('A-new');
    // A routine refresh doesn't replace the "previous" copy.
    expect(await storedSnapshot(prevSnapKey('accA'))).toBeNull();
  });

  it('keeps the previous copy when the account learns who it is for the first time', async () => {
    await seed({
      accounts: [account('accA', { capturedAt: 1 })],
      active: { acme: 'accA' },
      snapshots: { accA: snapshotOf([cookie('sid', 'unknown-before')], {}) },
    });
    browser.setCookie(cookie('sid', 'A'));
    browser.local.set(APP.origin, { 'sb-acme-auth-token': TOKEN_A });
    const tab = browser.addTab('https://acme.test/');

    await loaded(tab);
    await settle();

    expect((await storedSnapshot(snapKey('accA')))?.cookies[0]?.value).toBe('A');
    expect((await storedSnapshot(prevSnapKey('accA')))?.cookies[0]?.value).toBe('unknown-before');
    expect((await readState()).accounts[0]?.email).toBe('a@acme.test');
  });
});

describe('expired sessions', () => {
  async function seedSupabaseLike() {
    await seed({
      apps: [SUPABASE_LIKE],
      accounts: [account('accA', { email: 'a@acme.test', identityId: 'u-a', capturedAt: 1 })],
      active: { acme: 'accA' },
      snapshots: { accA: snapshotOf([cookie('sid', 'A')], { 'sb-acme-auth-token': TOKEN_A }) },
    });
  }

  it('a page that cannot be read (Chrome error page while offline) is neither signed out nor expired', async () => {
    await seedSupabaseLike();
    browser.setCookie(cookie('sid', 'A'));
    browser.local.set(APP.origin, { 'sb-acme-auth-token': TOKEN_A });
    const tab = browser.addTab('https://acme.test/dashboard');
    browser.scriptHook = (name) => {
      if (name === 'readPageStorage') throw new Error('Frame with ID 0 is showing error page');
      return undefined;
    };

    await loaded(tab);
    await settle(2900); // the watcher looks again after 2.5 s

    expect((await readState()).accounts[0]?.expiredAt).toBeUndefined();
    const engine = await import('../../src/background/engine');
    expect((await engine.probe(tab.id)).status).toBe('unknown');
  });

  it('a readable page with nobody signed in, seen twice, marks the account expired', async () => {
    await seedSupabaseLike();
    browser.local.set(APP.origin, {});
    const tab = browser.addTab('https://acme.test/dashboard');

    await loaded(tab);
    await settle(2900);

    expect((await readState()).accounts[0]?.expiredAt).toBeGreaterThan(0);
    const engine = await import('../../src/background/engine');
    expect((await engine.probe(tab.id)).status).toBe('signed-out');
  });
});

describe('after a switch', () => {
  it('records in the history when the site shows someone else than the chosen account', async () => {
    await seedAcme(browser, { settings: { autoCapture: false } });
    const tab = browser.addTab('https://acme.test/dashboard');
    wire();
    // The site keeps (or brings back) A's session: e.g. it signs in again through a provider.
    browser.scriptHook = (name) => {
      if (name !== 'writePageStorage') return undefined;
      browser.cookies = [];
      browser.setCookie(cookie('sid', 'A-live'));
      return { origin: APP.origin, errors: [] };
    };
    const engine = await import('../../src/background/engine');

    await engine.switchTo({ appId: 'acme', accountId: 'accB', kind: 'switch', tabId: tab.id });
    await until(async () => (await readState()).history.some((entry) => entry.error === 'WRONG_ACCOUNT'));

    const entry = (await readState()).history.find((item) => item.error === 'WRONG_ACCOUNT');
    expect(entry).toMatchObject({ ok: false, toId: 'accB', appId: 'acme' });
    // The page warns too (the toast).
    expect(browser.scripts.some((script) => script.name === 'showToast')).toBe(true);
  });
});

describe('the strip that shows the account on its pages', () => {
  const ribbonArgs = () =>
    browser.scripts.filter((script) => script.name === 'showRibbon').map((script) => script.args[0]);

  it('shows only important accounts by default', async () => {
    await seedAcme(browser, { a: { important: true } });
    const tab = browser.addTab('https://acme.test/');
    await loaded(tab);
    expect(ribbonArgs().at(-1)).toMatchObject({ tone: 'important', label: 'accA' });

    browser.scripts = [];
    await chrome.storage.local.set({ 'sd:active': { acme: 'accB' } });
    browser.local.set(APP.origin, { 'sb-acme-auth-token': sbToken('u-b', 'b@acme.test') });
    await loaded(tab);
    expect(ribbonArgs().at(-1)).toBeNull();
  });

  it('with "every account", names the account and the workspace in use (quiet style)', async () => {
    await seedAcme(browser, { settings: { pageRibbon: 'all' } });
    await chrome.storage.local.set({
      'sd:workspaces': [
        {
          id: 'ws1',
          name: 'Client X',
          color: '#2f4e86',
          members: { acme: 'accA' },
          links: [],
          order: 0,
          createdAt: 1,
          switchCount: 0,
        },
      ],
    });
    const tab = browser.addTab('https://acme.test/');

    await loaded(tab);

    expect(ribbonArgs().at(-1)).toEqual({ tag: 'Client X', label: 'accA', tone: 'calm', color: '#6d4cff' });
  });

  it('with "every account" and no workspace in use, shows the app and the account', async () => {
    await seedAcme(browser, { settings: { pageRibbon: 'all' } });
    const tab = browser.addTab('https://acme.test/');

    await loaded(tab);

    expect(ribbonArgs().at(-1)).toMatchObject({ tag: 'Acme', label: 'accA', tone: 'calm' });
  });
});
