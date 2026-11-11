import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeBrowser, seedAcme } from './fake-browser';

let browser: FakeBrowser;

beforeEach(() => {
  vi.resetModules();
  browser = new FakeBrowser();
  browser.install();
});

/** A lane of Acme in session storage, as the worker keeps it. */
async function seedLane(tabIds: number[], extra: Record<string, unknown> = {}) {
  const lane = {
    token: 'aaaaaaaaaaaa',
    kind: 'account',
    appId: 'acme',
    accountId: 'accB',
    tabIds,
    jar: [],
    ruleIds: [],
    createdAt: 1,
    title: 'B · Acme',
    color: '#2f4e86',
    groups: {},
    ...extra,
  };
  await chrome.storage.session.set({
    'sd:lanes': { lanes: { [lane.token]: lane }, tabs: Object.fromEntries(tabIds.map((id) => [id, lane.token])) },
  });
}

describe('unsaved work in a separate tab', () => {
  it("is looked for in the lane's own tabs only", async () => {
    await seedAcme(browser);
    const ordinary = browser.addTab('https://acme.test/editor');
    const lane = browser.addTab('https://acme.test/editor');
    const quiet = browser.addTab('https://acme.test/');
    await seedLane([lane.id, quiet.id]);
    browser.scriptHook = (name, tabId) =>
      name === 'unsavedWork'
        ? tabId === quiet.id
          ? { dirty: false, reason: null }
          : { dirty: true, reason: 'form' }
        : undefined;
    const { findLaneUnsaved } = await import('../../src/background/lane-ui');

    const found = await findLaneUnsaved('aaaaaaaaaaaa');

    expect(found.map((tab) => tab.tabId)).toEqual([lane.id]);
    expect(found[0]).toMatchObject({ appId: 'acme', reason: 'form' });
    const probed = browser.scripts.filter((script) => script.name === 'unsavedWork').map((script) => script.tabId);
    expect(probed).not.toContain(ordinary.id);
  });

  it('follows the setting, and knows nothing of a lane that has ended', async () => {
    await seedAcme(browser, { settings: { guardUnsaved: false } });
    const lane = browser.addTab('https://acme.test/editor');
    await seedLane([lane.id]);
    browser.scriptHook = (name) => (name === 'unsavedWork' ? { dirty: true, reason: 'typing' } : undefined);
    const { findLaneUnsaved } = await import('../../src/background/lane-ui');

    expect(await findLaneUnsaved('aaaaaaaaaaaa')).toEqual([]);
    expect(await findLaneUnsaved('bbbbbbbbbbbb')).toEqual([]);
    expect(browser.scripts.filter((script) => script.name === 'unsavedWork')).toHaveLength(0);
  });

  it('skips tabs that are gone or discarded', async () => {
    await seedAcme(browser);
    const discarded = browser.addTab('https://acme.test/editor', { discarded: true });
    await seedLane([discarded.id, 9999]);
    browser.scriptHook = (name) => (name === 'unsavedWork' ? { dirty: true, reason: 'form' } : undefined);
    const { findLaneUnsaved } = await import('../../src/background/lane-ui');

    expect(await findLaneUnsaved('aaaaaaaaaaaa')).toEqual([]);
  });
});
