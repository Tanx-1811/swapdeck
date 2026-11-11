import type { BrowserContext, Page, Worker } from '@playwright/test';
import { expect, test } from './fixtures';
import { activeAccount, addAcme, signIn, signOutByHand, storedAccounts, whoIsSignedIn } from './helpers';

const signedInAs = (email: string) => ({ server: email, cookie: email, storage: email });

type Call = <T = unknown>(
  type: string,
  payload?: Record<string, unknown>,
) => Promise<{ ok: boolean; data?: T; error?: string; detail?: string }>;

/** Alice and Bob saved; Bob is the account the browser's own tabs use. Returns the site tab. */
async function aliceAndBob(context: BrowserContext, acme: { id: string; origin: string }) {
  const site = await context.newPage();
  await signIn(site, acme.origin, 'alice@acme.test');
  await expect.poll(() => storedAccounts(context, acme.id)).toHaveLength(1);
  await signOutByHand(site);
  await signIn(site, acme.origin, 'bob@acme.test');
  await expect.poll(() => storedAccounts(context, acme.id)).toHaveLength(2);
  const accounts = await storedAccounts(context, acme.id);
  const alice = accounts.find((account) => account.email === 'alice@acme.test')!;
  const bob = accounts.find((account) => account.email === 'bob@acme.test')!;
  await expect.poll(() => activeAccount(context, acme.id)).toBe(bob.id);
  return { site, alice, bob };
}

/** Opens a lane through the worker and returns its page once the app has loaded there. */
async function openLane(context: BrowserContext, call: Call, payload: Record<string, unknown>) {
  const opened = context.waitForEvent('page');
  const result = await call<{ token: string; tabId: number }>('lane.open', payload);
  expect(result.ok, `${result.error} ${result.detail ?? ''}`).toBe(true);
  const page = await opened;
  await page.locator('#server-user').waitFor();
  return { page, token: result.data!.token, tabId: result.data!.tabId };
}

async function browserCookies(worker: Worker) {
  return worker.evaluate(async () =>
    (await chrome.cookies.getAll({ domain: 'acme.test' })).map((cookie) => `${cookie.name}=${cookie.value}`).sort(),
  );
}

async function lanes(worker: Worker) {
  return worker.evaluate(async () => {
    const raw = (await chrome.storage.session.get('sd:lanes'))['sd:lanes'] as
      | { lanes: Record<string, { token: string; kind: string; accountId: string | null; tabIds: number[] }> }
      | undefined;
    return Object.values(raw?.lanes ?? {});
  });
}

async function reloadAndRead(page: Page) {
  await page.reload();
  await page.locator('#server-user').waitFor();
  return whoIsSignedIn(page);
}

test.describe('separate tabs', () => {
  test('use a saved account in a separate tab while the other tabs keep theirs', async ({
    context,
    server,
    call,
    worker,
  }) => {
    const acme = await addAcme(call, server);
    const { site, alice } = await aliceAndBob(context, acme);
    const before = await browserCookies(worker);

    const lane = await openLane(context, call as Call, { appId: acme.id, accountId: alice.id });
    await expect(lane.page.locator('#server-user')).toHaveText('alice@acme.test');
    expect(await whoIsSignedIn(lane.page)).toEqual(signedInAs('alice@acme.test'));

    // The browser's own tabs and cookie store still say Bob.
    expect(await reloadAndRead(site)).toEqual(signedInAs('bob@acme.test'));
    expect(await browserCookies(worker)).toEqual(before);

    // Both stay put across reloads and API calls.
    expect(await reloadAndRead(lane.page)).toEqual(signedInAs('alice@acme.test'));
    const api = await lane.page.evaluate(() =>
      fetch('/dashboard').then((response) => response.text().then((text) => /server-user">([^<]*)</.exec(text)?.[1])),
    );
    expect(api).toBe('alice@acme.test');

    // The lane's tabs are grouped under the account's name.
    const group = await worker.evaluate(async (tabId) => {
      const tab = await chrome.tabs.get(tabId);
      return tab.groupId >= 0 ? (await chrome.tabGroups.get(tab.groupId)).title : null;
    }, lane.tabId);
    expect(group).toContain(alice.label);

    // The page's own view hides the browser's storage, and the browser's own pages hide the lane's.
    expect(await lane.page.evaluate(() => Object.keys(localStorage))).toEqual(['sb-acme-auth-token']);
    expect(await site.evaluate(() => Object.keys(localStorage))).toEqual(['sb-acme-auth-token']);
    expect(await site.evaluate(() => localStorage.length)).toBe(1);
  });

  test('a scratch tab signs in someone new without touching the browser, and can be saved', async ({
    context,
    server,
    call,
    worker,
  }) => {
    const acme = await addAcme(call, server);
    const { site } = await aliceAndBob(context, acme);
    const before = await browserCookies(worker);

    const lane = await openLane(context, call as Call, { appId: acme.id, accountId: null });
    expect(await whoIsSignedIn(lane.page)).toEqual({ server: 'nobody', cookie: 'nobody', storage: 'nobody' });
    await signIn(lane.page, acme.origin, 'carol@acme.test');
    expect(await whoIsSignedIn(lane.page)).toEqual(signedInAs('carol@acme.test'));
    expect(await reloadAndRead(site)).toEqual(signedInAs('bob@acme.test'));
    expect(await browserCookies(worker)).toEqual(before);
    // Nothing was saved automatically from a scratch tab.
    expect(await storedAccounts(context, acme.id)).toHaveLength(2);

    const saved = await call<{ accountId: string; created: boolean }>('lane.save', { token: lane.token });
    expect(saved.ok).toBe(true);
    expect(saved.data?.created).toBe(true);
    const carol = (await storedAccounts(context, acme.id)).find((account) => account.email === 'carol@acme.test');
    expect(carol?.id).toBe(saved.data?.accountId);
    // The scratch tab is now Carol's separate tab; the browser's own tabs still use Bob.
    await expect.poll(async () => (await lanes(worker))[0]?.accountId).toBe(carol!.id);
    expect((await storedAccounts(context, acme.id)).length).toBe(3);
  });

  test('a page opened from a separate tab stays in it; closing the last tab ends it and cleans up', async ({
    context,
    server,
    call,
    worker,
  }) => {
    const acme = await addAcme(call, server);
    const { site, alice } = await aliceAndBob(context, acme);
    const lane = await openLane(context, call as Call, { appId: acme.id, accountId: alice.id });

    const popup = context.waitForEvent('page');
    await lane.page.evaluate((url) => void window.open(url, '_blank'), `${acme.origin}/project/abc123`);
    const child = await popup;
    await child.locator('#server-user').waitFor();
    await expect(child.locator('#server-user')).toHaveText('alice@acme.test');
    expect(await whoIsSignedIn(child)).toEqual(signedInAs('alice@acme.test'));
    await expect.poll(async () => (await lanes(worker))[0]?.tabIds.length).toBe(2);

    await child.close();
    await lane.page.close();
    await expect.poll(async () => (await lanes(worker)).length).toBe(0);
    // No rules of the lane are left, and the site's storage lost the lane's keys.
    expect(await worker.evaluate(async () => (await chrome.declarativeNetRequest.getSessionRules()).length)).toBe(0);
    await site.reload();
    await expect.poll(() => site.evaluate(() => Object.keys(window.localStorage))).toEqual(['sb-acme-auth-token']);
    expect(await whoIsSignedIn(site)).toEqual(signedInAs('bob@acme.test'));
  });

  test('switching the browser to an account open in a separate tab takes that tab over', async ({
    context,
    server,
    call,
    worker,
    tabIdOf,
  }) => {
    const acme = await addAcme(call, server);
    const { site, alice } = await aliceAndBob(context, acme);
    const lane = await openLane(context, call as Call, { appId: acme.id, accountId: alice.id });

    const switched = await call('switch', { appId: acme.id, accountId: alice.id, tabId: await tabIdOf(site) });
    expect(switched.ok, switched.error).toBe(true);
    await expect(site.locator('#server-user')).toHaveText('alice@acme.test');
    expect(await whoIsSignedIn(site)).toEqual(signedInAs('alice@acme.test'));
    expect(await lanes(worker)).toEqual([]);
    expect(await activeAccount(context, acme.id)).toBe(alice.id);
    // The former separate tab came back with the switch: an ordinary tab with the browser's (Alice's) sign-in.
    await expect(lane.page.locator('#server-user')).toHaveText('alice@acme.test');
    expect(await reloadAndRead(lane.page)).toEqual(signedInAs('alice@acme.test'));
    // Nothing of the lane is left: no rules, no names on the site.
    expect(await worker.evaluate(async () => (await chrome.declarativeNetRequest.getSessionRules()).length)).toBe(0);
    await expect.poll(() => site.evaluate(() => Object.keys(window.localStorage))).toEqual(['sb-acme-auth-token']);
  });

  test("shows cookies the site's responses set in document.cookie, and behaves like localStorage", async ({
    context,
    server,
    call,
    worker,
  }) => {
    const acme = await addAcme(call, server);
    const { site, alice } = await aliceAndBob(context, acme);
    const lane = await openLane(context, call as Call, { appId: acme.id, accountId: alice.id });

    await lane.page.evaluate(() => fetch('/api/csrf'));
    await expect
      .poll(() => lane.page.evaluate(() => document.cookie))
      .toContain(`acme_csrf=${encodeURIComponent('alice@acme.test')}`);
    // The browser's own cookies never got it.
    expect((await browserCookies(worker)).some((cookie) => cookie.startsWith('acme_csrf='))).toBe(false);

    // The lane's localStorage acts as one, in the lane and (hiding the lane's keys) in other tabs.
    for (const page of [lane.page, site]) {
      await page.reload();
      expect(
        await page.evaluate(() => ({
          // Called the way sites call it, through the storage object (the proxy's own `get`).
          /* eslint-disable no-prototype-builtins */
          own: localStorage.hasOwnProperty('sb-acme-auth-token'),
          missing: localStorage.hasOwnProperty('nope'),
          /* eslint-enable no-prototype-builtins */
          text: String(localStorage),
          isStorage: localStorage instanceof Storage,
          constructor: localStorage.constructor === Storage,
          has: 'getItem' in localStorage,
        })),
      ).toEqual({ own: true, missing: false, text: '[object Storage]', isStorage: true, constructor: true, has: true });
    }
  });

  test('refuses to open the account the browser already uses', async ({ context, server, call }) => {
    const acme = await addAcme(call, server);
    const { bob } = await aliceAndBob(context, acme);
    const result = await (call as Call)('lane.open', { appId: acme.id, accountId: bob.id });
    expect(result).toMatchObject({ ok: false, error: 'INVALID', detail: 'in-use' });
  });

  test('never saves another person into the account of a separate tab', async ({ context, server, call, worker }) => {
    const acme = await addAcme(call, server);
    const { alice } = await aliceAndBob(context, acme);
    const lane = await openLane(context, call as Call, { appId: acme.id, accountId: alice.id });
    await signOutByHand(lane.page);
    await signIn(lane.page, acme.origin, 'carol@acme.test');
    await expect.poll(async () => (await lanes(worker))[0] && (await lanes(worker))[0]).toBeTruthy();
    await lane.page.close();
    await expect.poll(async () => (await lanes(worker)).length).toBe(0);
    // Alice's saved session is still Alice's: a lane on it shows her again.
    const again = await openLane(context, call as Call, { appId: acme.id, accountId: alice.id });
    expect(await whoIsSignedIn(again.page)).toEqual(signedInAs('alice@acme.test'));
  });
});

test.describe('separate tabs in the popup', () => {
  test('opens an account in a separate tab from its menu and explains the tab there', async ({
    context,
    server,
    call,
    openPopup,
  }) => {
    const acme = await addAcme(call, server);
    const { site, alice } = await aliceAndBob(context, acme);

    const popup = await openPopup(site);
    await popup.getByRole('button', { name: `More actions: ${alice.label}` }).click();
    const opened = context.waitForEvent('page');
    await popup.getByRole('menuitem', { name: 'Open in a separate tab' }).click();
    const lanePage = await opened;
    await expect(lanePage.locator('#server-user')).toHaveText('alice@acme.test');
    await expect(popup.locator('.flag-lane')).toHaveCount(1);
    if (process.env.SHOTS) await popup.screenshot({ path: `${process.env.SHOTS}/popup-normal-tab.png` });

    const inLane = await openPopup(lanePage);
    await expect(inLane.locator('.callout--brand').first()).toContainText('Separate tab');
    await expect(inLane.locator('.callout--brand').first()).toContainText('alice@acme.test');
    await expect(inLane.getByRole('button', { name: 'Use in all tabs' })).toBeVisible();
    if (process.env.SHOTS) await inLane.screenshot({ path: `${process.env.SHOTS}/popup-lane-tab.png` });

    // A scratch tab from the popup, then "Save as account" from the popup in it.
    const scratchOpened = context.waitForEvent('page');
    await popup.getByRole('button', { name: 'Scratch tab' }).click();
    const scratch = await scratchOpened;
    // The scratch tab opens the app by itself; signing in starts once it has.
    await scratch.locator('#server-user', { hasText: 'nobody' }).waitFor();
    await signIn(scratch, acme.origin, 'carol@acme.test');
    const inScratch = await openPopup(scratch);
    if (process.env.SHOTS) await inScratch.screenshot({ path: `${process.env.SHOTS}/popup-scratch-tab.png` });
    await inScratch.getByRole('button', { name: 'Save as account' }).click();
    await expect.poll(async () => (await storedAccounts(context, acme.id)).length).toBe(3);
    await expect(site.locator('#server-user')).toHaveText('bob@acme.test');
  });
});

test.describe('separate tabs after a restart', () => {
  test('come back in their tab groups with their account', async ({ context, server, call, worker }) => {
    const acme = await addAcme(call, server);
    const { site, alice } = await aliceAndBob(context, acme);
    const lane = await openLane(context, call as Call, { appId: acme.id, accountId: alice.id });
    await expect(lane.page.locator('#server-user')).toHaveText('alice@acme.test');

    // What Chrome forgets when it restarts (or the extension updates): the lanes, their rules and scripts.
    await worker.evaluate(async () => {
      await chrome.storage.session.remove('sd:lanes');
      const rules = await chrome.declarativeNetRequest.getSessionRules();
      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: rules.map((rule) => rule.id) });
      const scripts = await chrome.scripting.getRegisteredContentScripts();
      if (scripts.length) await chrome.scripting.unregisterContentScripts({ ids: scripts.map((item) => item.id) });
    });
    // The worker starts with nothing in memory; Chrome brings the group's tab back with its own sign-in.
    await worker.evaluate(() =>
      (
        globalThis as unknown as { swapdeckTest: { forgetLanesForTest: () => Promise<void> } }
      ).swapdeckTest.forgetLanesForTest(),
    );
    await lane.page.reload();
    await expect(lane.page.locator('#server-user')).toHaveText('bob@acme.test');

    await worker.evaluate(() =>
      (globalThis as unknown as { swapdeckTest: { restoreLanes: () => Promise<void> } }).swapdeckTest.restoreLanes(),
    );
    await expect(lane.page.locator('#server-user')).toHaveText('alice@acme.test');
    expect(await whoIsSignedIn(lane.page)).toEqual(signedInAs('alice@acme.test'));
    expect(await reloadAndRead(site)).toEqual(signedInAs('bob@acme.test'));
  });
});
