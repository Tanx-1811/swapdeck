import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readState } from '../../src/shared/store';
import { APP, FakeBrowser, seedAcme, settle, until } from './fake-browser';

let browser: FakeBrowser;

beforeEach(() => {
  vi.resetModules();
  browser = new FakeBrowser();
  browser.install();
});

const asked = () => browser.scripts.filter((script) => script.name === 'askOnPage');

describe('switches started from a shortcut, the address bar or a menu', () => {
  it('ask about unsaved work before re-opening the account in use (it reloads the tabs too)', async () => {
    await seedAcme(browser);
    const tab = browser.addTab('https://acme.test/editor');
    browser.scriptHook = (name) => {
      if (name === 'unsavedWork') return { dirty: true, reason: 'form' };
      if (name === 'askOnPage') return false;
      return undefined;
    };
    const { runGuarded } = await import('../../src/background/guarded');

    const result = await runGuarded({ kind: 'account', appId: 'acme', accountId: 'accA', tabId: tab.id });
    await settle();

    expect(asked()).toHaveLength(1);
    expect(result).toBe('cancelled');
    expect(browser.tabs.get(tab.id)?.url).toBe('https://acme.test/editor');
  });

  it('follow "ask before switching" too', async () => {
    await seedAcme(browser, { settings: { confirmSwitch: true } });
    const tab = browser.addTab('https://acme.test/');
    browser.scriptHook = (name) => (name === 'askOnPage' ? false : undefined);
    const { runGuarded } = await import('../../src/background/guarded');

    const result = await runGuarded({ kind: 'account', appId: 'acme', accountId: 'accB', tabId: tab.id });

    expect(asked()).toHaveLength(1);
    expect(result).toBe('cancelled');
    expect((await readState()).active.acme).toBe('accA');
  });

  it('switch without asking when nothing calls for it', async () => {
    await seedAcme(browser);
    const tab = browser.addTab('https://acme.test/');
    const { runGuarded } = await import('../../src/background/guarded');

    expect(await runGuarded({ kind: 'account', appId: 'acme', accountId: 'accB', tabId: tab.id })).toBe('done');
    expect(asked()).toHaveLength(0);
    expect((await readState()).active.acme).toBe('accB');
  });

  it('put the menu check back on the account in use when a switch is cancelled', async () => {
    await seedAcme(browser, { b: { important: true } });
    const tab = browser.addTab('https://acme.test/');
    browser.scriptHook = (name) => (name === 'askOnPage' ? false : undefined);
    const { runGuarded } = await import('../../src/background/guarded');
    const menus = await import('../../src/background/menus');
    menus.scheduleMenuRebuild(0);
    await until(() => browser.menuRebuilds === 1);

    await runGuarded({ kind: 'account', appId: 'acme', accountId: 'accB', tabId: tab.id });

    // Nothing changed in the state, yet the menus are built again (Chrome had already moved the check).
    await until(() => browser.menuRebuilds === 2);
  });

  it('close the blank "Open link as" tab when the answer in the small window is no', async () => {
    await seedAcme(browser, { b: { important: true } });
    const blank = browser.addTab('about:blank', { active: false });
    // No page can show the question (the blank tab can't be scripted): it goes to the small window.
    browser.scriptHook = (name) => {
      if (name === 'askOnPage') throw new Error('Cannot access contents of url "about:blank"');
      return undefined;
    };
    const { answerAsk, runGuarded } = await import('../../src/background/guarded');

    const result = await runGuarded({
      kind: 'account',
      appId: 'acme',
      accountId: 'accB',
      tabId: blank.id,
      url: 'https://acme.test/invite/x',
      blankTab: true,
    });
    expect(result).toBe('asked');
    const pending = (await chrome.storage.session.get('sd:ask'))['sd:ask'] as { id: string };

    await answerAsk(pending.id, false);
    await settle();

    expect(browser.tabs.has(blank.id)).toBe(false);
    expect((await readState()).active.acme).toBe('accA');
  });
});

describe('workspace switches', () => {
  it('switch an app again when its page shows someone else than the account recorded as in use', async () => {
    await seedAcme(browser);
    await chrome.storage.local.set({
      'sd:workspaces': [
        {
          id: 'ws1',
          name: 'Client A',
          color: '#2f4e86',
          members: { acme: 'accA' },
          links: [],
          order: 0,
          createdAt: 1,
          switchCount: 0,
        },
      ],
    });
    // The watcher saw B signed in on Acme while A is recorded as in use.
    browser.local.set(APP.origin, { 'sb-acme-auth-token': '{"access_token":"x","user":{"id":"u-b"}}' });
    await chrome.storage.session.set({
      'sd:live': { acme: { identity: { confidence: 'strong', source: 'x', id: 'u-b' }, mismatch: true, checkedAt: 1 } },
    });
    const tab = browser.addTab('https://acme.test/');
    const { switchWorkspace } = await import('../../src/background/workspaces');

    const outcome = await switchWorkspace('ws1', tab.id);
    await settle();

    expect(outcome.results).toEqual([{ appId: 'acme', accountId: 'accA', status: 'switched' }]);
    expect(browser.cookie('sid')).toBe('A-session');
  });

  it('do not count a workspace as used when none of its apps could be switched', async () => {
    await seedAcme(browser);
    await chrome.storage.local.remove('sd:snap:accB');
    await chrome.storage.local.set({
      'sd:workspaces': [
        {
          id: 'ws1',
          name: 'Client B',
          color: '#2f4e86',
          members: { acme: 'accB' },
          links: [],
          order: 0,
          createdAt: 1,
          switchCount: 0,
        },
      ],
    });
    const tab = browser.addTab('https://acme.test/');
    const { switchWorkspace } = await import('../../src/background/workspaces');

    const outcome = await switchWorkspace('ws1', tab.id);
    await settle();

    expect(outcome).toMatchObject({ switched: 0, failed: 1 });
    const workspace = (await readState()).workspaces[0]!;
    expect(workspace.lastUsedAt).toBeUndefined();
    expect(workspace.switchCount).toBe(0);
  });
});
