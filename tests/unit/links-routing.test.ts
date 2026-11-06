import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readState } from '../../src/shared/store';
import { APP, FakeBrowser, seedAcme, settle, until } from './fake-browser';

let browser: FakeBrowser;

const PROJECT_APP = { ...APP, recentPattern: '^/project/([a-z0-9]+)' };
const LINK = 'https://acme.test/invite/one-time-token';

beforeEach(() => {
  vi.resetModules();
  browser = new FakeBrowser();
  browser.install();
});

async function seedProjects(settings: Record<string, unknown> = {}) {
  await seedAcme(browser, {
    app: PROJECT_APP,
    settings,
    a: { recents: [{ key: 'aaa', title: 'Project A', url: 'https://acme.test/project/aaa', at: 1 }] },
    b: {
      lastUrl: 'https://acme.test/project/bbb',
      recents: [{ key: 'bbb', title: 'Project B', url: 'https://acme.test/project/bbb', at: 1 }],
    },
  });
}

async function wireWatcher() {
  const watcher = await import('../../src/background/watcher');
  browser.updated.add((tabId, info, tab) => {
    void watcher.onTabUpdated(tabId as number, info as chrome.tabs.OnUpdatedInfo, tab as chrome.tabs.Tab);
  });
}

const switches = async () => (await readState()).history.map((entry) => `${entry.kind}:${entry.toId}`).reverse();

describe('right-click → "Open link as" another account', () => {
  it('never requests the link with the account in use: the switch happens first, in a blank tab', async () => {
    await seedProjects();
    const page = browser.addTab('https://acme.test/project/aaa');
    const { openLinkAs } = await import('../../src/background/links');

    await openLinkAs('acme', 'accB', LINK, page.id);
    await settle(100);

    const loads = browser.requests.filter((request) => request.url === LINK);
    expect(loads.map((request) => request.sid)).toEqual(['B-session']);
    expect((await readState()).active.acme).toBe('accB');
    // The link is in a new tab next to the page, brought to the front.
    const opened = [...browser.tabs.values()].find((tab) => tab.url === LINK)!;
    expect(opened.id).not.toBe(page.id);
    expect(opened.active).toBe(true);
  });

  it('closes the blank tab, without opening the link, when the switch is cancelled', async () => {
    await seedProjects();
    const page = browser.addTab('https://acme.test/project/aaa');
    // The account is important: asked on the page the link was found on; the user says no.
    await chrome.storage.local.set({
      'sd:accounts': (await readState()).accounts.map((item) =>
        item.id === 'accB' ? { ...item, important: true } : item,
      ),
    });
    const asked: number[] = [];
    browser.scriptHook = (name, tabId) => {
      if (name === 'askOnPage') {
        asked.push(tabId);
        return false;
      }
      return undefined;
    };
    const { openLinkAs } = await import('../../src/background/links');

    await openLinkAs('acme', 'accB', LINK, page.id);
    await settle();

    expect(asked).toEqual([page.id]);
    expect(browser.requests.some((request) => request.url === LINK)).toBe(false);
    expect([...browser.tabs.keys()]).toEqual([page.id]);
    expect((await readState()).active.acme).toBe('accA');
  });

  it('just opens the link when its account is already in use', async () => {
    await seedProjects();
    const { openLinkAs } = await import('../../src/background/links');
    await openLinkAs('acme', 'accA', LINK);
    await settle();
    expect(browser.requests.map((request) => request.sid)).toEqual(['A-live']);
    expect(await switches()).toEqual([]);
  });
});

describe('links of another account, "switch at once"', () => {
  it('does not undo a switch the user just made (after switching: "same page")', async () => {
    await seedProjects({ linkRouting: 'auto', afterSwitch: 'same' });
    const tab = browser.addTab('https://acme.test/project/aaa');
    await wireWatcher();
    const engine = await import('../../src/background/engine');

    await engine.switchTo({ appId: 'acme', accountId: 'accB', kind: 'switch', tabId: tab.id });
    await settle(400);

    expect(await switches()).toEqual(['switch:accB']);
    expect((await readState()).active.acme).toBe('accB');
  });

  it('does not undo a switch when a tab in another window shows the previous account’s page', async () => {
    await seedProjects({ linkRouting: 'auto' });
    const here = browser.addTab('https://acme.test/project/aaa');
    browser.addTab('https://acme.test/project/aaa', { windowId: 2 });
    await wireWatcher();
    const engine = await import('../../src/background/engine');

    await engine.switchTo({ appId: 'acme', accountId: 'accB', kind: 'switch', tabId: here.id });
    await settle(400);

    expect(await switches()).toEqual(['switch:accB']);
  });

  it('still switches for a page of another account opened in another tab right after a switch', async () => {
    await seedProjects({ linkRouting: 'auto' });
    await chrome.storage.local.set({ 'sd:active': { acme: 'accB' } });
    browser.local.set(APP.origin, { 'sb-acme-auth-token': '{"access_token":"x","user":{"id":"u-b"}}' });
    const here = browser.addTab('https://acme.test/');
    await wireWatcher();
    const engine = await import('../../src/background/engine');
    // The user switched back to A a moment ago…
    await engine.switchTo({ appId: 'acme', accountId: 'accA', kind: 'switch', tabId: here.id });
    await settle(200);

    // …then opens a link to B's project in a new tab (say, from a chat).
    const tab = browser.addTab('about:blank');
    browser.navigate(tab.id, 'https://acme.test/project/bbb');
    await until(async () => (await readState()).active.acme === 'accB');

    expect(await switches()).toEqual(['switch:accA', 'switch:accB']);
    expect(browser.tabs.get(tab.id)?.url).toBe('https://acme.test/project/bbb');
  });
});
