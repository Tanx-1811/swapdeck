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

test.describe('pages in and beside separate tabs keep working', () => {
  test('native Storage methods and site wrappers of them work on localStorage', async ({ context, server, call }) => {
    const acme = await addAcme(call, server);
    const { site, alice } = await aliceAndBob(context, acme);
    const lane = await openLane(context, call as Call, { appId: acme.id, accountId: alice.id });
    // The site's own tab, loaded again now that the lane's keys exist on the origin.
    await site.reload();

    for (const page of [lane.page, site]) {
      const result = await page.evaluate(() => {
        const proto = Storage.prototype as Storage & Record<string, unknown>;
        // What consent managers and analytics do: wrap a method, and add one that calls the original.
        const seen: string[] = [];
        const originalSet = proto.setItem;
        proto.setItem = function (this: Storage, key: string, value: string) {
          seen.push(key);
          return originalSet.call(this, key, value);
        };
        const originalRemove = proto.removeItem;
        proto.siteRemove = function (this: Storage, key: string) {
          return originalRemove.call(this, key);
        };
        try {
          localStorage.setItem('probe', '1');
          const out = {
            seen: [...seen],
            got: proto.getItem.call(localStorage, 'probe'),
            length: Object.getOwnPropertyDescriptor(Storage.prototype, 'length')!.get!.call(localStorage),
            keys: [0, 1].map((index) => proto.key.call(localStorage, index)).sort(),
            removed: (localStorage as unknown as { siteRemove: (key: string) => void }).siteRemove('probe'),
            after: localStorage.getItem('probe'),
            session: proto.getItem.call(sessionStorage, 'nothing-here'),
            names: [proto.getItem.name, proto.setItem.length, proto.removeItem.length],
          };
          return out;
        } catch (error) {
          return String(error);
        } finally {
          proto.setItem = originalSet;
          delete proto.siteRemove;
        }
      });
      expect(result).toEqual({
        seen: ['probe'],
        got: '1',
        length: 2,
        keys: ['probe', 'sb-acme-auth-token'],
        removed: undefined,
        after: null,
        session: null,
        names: ['getItem', 2, 1],
      });
    }
    // Each saw its own: the lane's probe never showed in the browser's tab, nor the other way round.
    expect(await whoIsSignedIn(lane.page)).toEqual(signedInAs('alice@acme.test'));
    expect(await reloadAndRead(site)).toEqual(signedInAs('bob@acme.test'));
  });

  test("calls the app's other origins with CORS like any tab, with the lane's cookies", async ({
    context,
    server,
    call,
    worker,
  }) => {
    const acme = await addAcme(call, server);
    const { site, alice } = await aliceAndBob(context, acme);
    const lane = await openLane(context, call as Call, { appId: acme.id, accountId: alice.id });
    // A cookie for the whole site, set by the lane's page: the API on another origin gets it.
    await lane.page.evaluate(() => (document.cookie = 'acme_api=lane; domain=acme.test; path=/'));
    const api = server.url('api.acme.test', '/api/cors');
    const calls = (page: Page) =>
      page.evaluate(async (url) => {
        try {
          const post = await fetch(url, { method: 'POST', credentials: 'include', body: 'x' }).then((r) => r.json());
          // A JSON call: preflighted, and the API allows only content-type.
          const json = await fetch(url, {
            method: 'POST',
            credentials: 'include',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          }).then((r) => r.json());
          const get = await fetch(url, { credentials: 'include' }).then((r) => r.json());
          const xhr = await new Promise((resolve, reject) => {
            const request = new XMLHttpRequest();
            request.open('POST', url);
            request.withCredentials = true;
            request.onload = () => resolve(JSON.parse(request.responseText));
            request.onerror = () => reject(new Error('xhr failed'));
            request.send('x');
          });
          return [post, json, get, xhr] as { cookie: string }[];
        } catch (error) {
          return String(error);
        }
      }, api);
    const inLane = await calls(lane.page);
    expect(Array.isArray(inLane), String(inLane)).toBe(true);
    for (const answer of inLane as { cookie: string }[]) expect(answer.cookie).toBe('acme_api=lane');
    const inSite = await calls(site);
    expect(Array.isArray(inSite), String(inSite)).toBe(true);
    for (const answer of inSite as { cookie: string }[]) expect(answer.cookie).toBe('');
    expect((await browserCookies(worker)).some((cookie) => cookie.startsWith('acme_api='))).toBe(false);
  });

  test("signs the site's WebSockets in as the lane's account", async ({ context, server, call }) => {
    const acme = await addAcme(call, server);
    const { site, alice } = await aliceAndBob(context, acme);
    const lane = await openLane(context, call as Call, { appId: acme.id, accountId: alice.id });
    const socket = (url: string) =>
      new Promise<string>((resolve, reject) => {
        const ws = new WebSocket(url);
        ws.onmessage = (event) => resolve(String(event.data));
        ws.onerror = () => reject(new Error('socket failed'));
      });
    const url = server.url('acme.test', '/socket').replace(/^http/, 'ws');
    expect(await lane.page.evaluate(socket, url)).toBe('alice@acme.test');
    expect(await site.evaluate(socket, url)).toBe('bob@acme.test');
  });

  test("never shares the browser's HTTP cache with the other tabs, either way", async ({ context, server, call }) => {
    const acme = await addAcme(call, server);
    const { site, alice } = await aliceAndBob(context, acme);
    const lane = await openLane(context, call as Call, { appId: acme.id, accountId: alice.id });
    // Pages the site lets the browser keep for ten minutes, opened as a link would (the cache is used).
    const visit = async (page: Page, path: string) => {
      await page.evaluate((url) => (location.href = url), `${acme.origin}${path}`);
      await page.waitForURL(`**${path}`);
      return page.locator('#server-user').textContent();
    };
    expect(await visit(lane.page, '/cached?page=1')).toBe('alice@acme.test');
    expect(await visit(site, '/cached?page=1')).toBe('bob@acme.test');
    expect(await visit(site, '/cached?page=2')).toBe('bob@acme.test');
    expect(await visit(lane.page, '/cached?page=2')).toBe('alice@acme.test');

    // The same for the page's own calls (same origin).
    const load = (page: Page, path: string, how: 'fetch' | 'xhr') =>
      page.evaluate(
        ([url, kind]) =>
          (kind === 'fetch'
            ? fetch(url!).then((response) => response.text())
            : new Promise<string>((resolve) => {
                const request = new XMLHttpRequest();
                request.open('GET', url!);
                request.onload = () => resolve(request.responseText);
                request.send();
              })
          ).then((text) => /server-user">([^<]*)</.exec(text)?.[1]),
        [`${acme.origin}${path}`, how] as const,
      );
    for (const how of ['fetch', 'xhr'] as const) {
      expect(await load(lane.page, `/cached?${how}=1`, how)).toBe('alice@acme.test');
      expect(await load(site, `/cached?${how}=1`, how)).toBe('bob@acme.test');
      expect(await load(site, `/cached?${how}=2`, how)).toBe('bob@acme.test');
      expect(await load(lane.page, `/cached?${how}=2`, how)).toBe('alice@acme.test');
    }
  });

  test('document.cookie reads like a browser after writes; requests keep their semantics', async ({
    context,
    server,
    call,
  }) => {
    const acme = await addAcme(call, server);
    const { alice } = await aliceAndBob(context, acme);
    const lane = await openLane(context, call as Call, { appId: acme.id, accountId: alice.id });
    await lane.page.goto(`${acme.origin}/project/abc123`);
    const written = await lane.page.evaluate(() => {
      document.cookie = 'dup=root; path=/';
      document.cookie = 'dup=deep; path=/project';
      // What a browser ignores: Secure from an http page, a broken prefix, another site's domain.
      document.cookie = 'sec=1; Secure';
      document.cookie = '__Host-h=1; path=/';
      document.cookie = 'other=1; domain=other.test';
      return document.cookie.split('; ');
    });
    // At once: the page's last write shows, and nothing a browser would ignore.
    expect(written).toContain('dup=deep');
    expect(written.some((item) => /^(sec|__Host-h|other)=/.test(item))).toBe(false);
    // Once the lane has them, still the same (two cookies of one name, the longer path first).
    await expect
      .poll(() => lane.page.evaluate(() => document.cookie.split('; ').filter((item) => item.startsWith('dup='))))
      .toEqual(['dup=deep', 'dup=root']);

    const xhr = await lane.page.evaluate(() => {
      document.cookie = 'pending=1; path=/';
      // A synchronous request has its answer when send() returns, even with a cookie write pending.
      const sync = new XMLHttpRequest();
      sync.open('GET', '/api/cors', false);
      sync.send();
      // send() before open() throws, as it always does.
      document.cookie = 'pending=2; path=/';
      let thrown = 'nothing';
      try {
        new XMLHttpRequest().send();
      } catch (error) {
        thrown = (error as DOMException).name;
      }
      return { status: sync.status, thrown };
    });
    expect(xhr).toEqual({ status: 200, thrown: 'InvalidStateError' });
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
    const card = inLane.locator('.callout', { hasText: 'Separate tab' });
    await expect(card).toContainText(alice.label);
    await expect(card).toContainText('Signed in here as alice@acme.test');
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

test.describe('separate tabs when the worker restarts', () => {
  test("keep taking the cookies their site sets after Swapdeck's worker started again", async ({
    context,
    server,
    call,
    worker,
  }) => {
    const acme = await addAcme(call, server);
    const { alice } = await aliceAndBob(context, acme);
    const lane = await openLane(context, call as Call, { appId: acme.id, accountId: alice.id });

    // Chrome stops an extension's worker now and then: the lanes' rules and record stay, its memory goes.
    await worker.evaluate(() =>
      (
        globalThis as unknown as { swapdeckTest: { restartWorkerForTest: () => Promise<void> } }
      ).swapdeckTest.restartWorkerForTest(),
    );

    await lane.page.evaluate(() => fetch('/api/csrf'));
    await expect
      .poll(() => lane.page.evaluate(() => document.cookie))
      .toContain(`acme_csrf=${encodeURIComponent('alice@acme.test')}`);
    expect(await reloadAndRead(lane.page)).toEqual(signedInAs('alice@acme.test'));
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
