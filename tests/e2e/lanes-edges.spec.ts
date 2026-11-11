import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { addAcme, whoIsSignedIn } from './helpers';
import {
  aliceAndBob,
  browserCookies,
  echoOf,
  lanes,
  names,
  openLane,
  reloadAndRead,
  signedInAs,
  type Call,
} from './lane-helpers';

const ALICE = `acme_sid=${encodeURIComponent('alice@acme.test')}`;

test.describe('tabs a separate tab opens join it before their first request', () => {
  test('a link, a posted form and window.open reach the server with the lane cookies the first time', async ({
    context,
    server,
    call,
    worker,
  }) => {
    const acme = await addAcme(call, server);
    const { alice } = await aliceAndBob(context, acme);
    const lane = await openLane(context, call as Call, { appId: acme.id, accountId: alice.id });
    await lane.page.goto(`${acme.origin}/opener`);
    server.log.length = 0;
    const firstRequests = (via: string) => server.log.filter((item) => item.path.includes(`via=${via}`));

    // A form posted into a new tab.
    let opened = context.waitForEvent('page');
    await lane.page.locator('#submit').click();
    const posted = await opened;
    expect(await echoOf(posted)).toMatchObject({ method: 'POST', body: 'field=value&button=pressed' });
    expect((await echoOf(posted)).cookie).toContain(ALICE);
    expect(firstRequests('form')).toHaveLength(1);
    expect(firstRequests('form')[0]).toMatchObject({ method: 'POST' });
    expect(firstRequests('form')[0]!.cookie).toContain(ALICE);
    // Sent from the page, as its own form would be.
    expect(firstRequests('form')[0]!.referer).toBe(`${acme.origin}/opener`);

    // A link to a new tab (noopener, as target=_blank is).
    opened = context.waitForEvent('page');
    await lane.page.locator('#link').click();
    const linked = await opened;
    expect((await echoOf(linked)).cookie).toContain(ALICE);
    expect(await linked.evaluate(() => window.opener)).toBeNull();
    expect(firstRequests('link').map((item) => item.cookie)).toEqual([expect.stringContaining(ALICE)]);

    // window.open, OAuth style: the page keeps the window it got, and the window its opener.
    opened = context.waitForEvent('page');
    await lane.page.evaluate(() => {
      const w = window.open('/echo-page?via=open', 'sign-in', 'width=480,height=600');
      (window as unknown as { popup: Window | null }).popup = w;
      addEventListener('message', (event) => (document.title = String(event.data)));
    });
    const popup = await opened;
    await popup.waitForURL('**via=open');
    expect((await echoOf(popup)).cookie).toContain(ALICE);
    expect(firstRequests('open').map((item) => item.cookie)).toEqual([expect.stringContaining(ALICE)]);
    expect(firstRequests('open')[0]!.referer).toBe(`${acme.origin}/opener`);
    await popup.evaluate(() => window.opener.postMessage('signed-in', '*'));
    await expect(lane.page).toHaveTitle('signed-in');
    expect(await lane.page.evaluate(() => (window as unknown as { popup: Window }).popup.closed)).toBe(false);
    await popup.close();
    await expect.poll(() => lane.page.evaluate(() => (window as unknown as { popup: Window }).popup.closed)).toBe(true);

    // A GET form, and a link whose click the page stops on its way (React's stopPropagation).
    for (const [selector, via] of [
      ['#submit-get', 'get-form'],
      ['#stopped', 'stopped'],
    ] as const) {
      opened = context.waitForEvent('page');
      await lane.page.locator(selector).click();
      const page = await opened;
      await page.waitForURL(`**via=${via}*`);
      expect((await echoOf(page)).cookie, via).toContain(ALICE);
      expect(firstRequests(via).map((item) => item.cookie)).toEqual([expect.stringContaining(ALICE)]);
    }
    // The card around the stopped link never saw the click.
    expect(await lane.page.title()).toBe('signed-in');

    // Every one of them is the lane's tab; the browser's cookies never got the lane's.
    await expect.poll(async () => (await lanes(worker))[0]?.tabIds.length).toBe(5);
    expect(await browserCookies(worker)).not.toContain(`acme_sid=alice@acme.test`);
  });

  test('a form sent to a new tab with Ctrl goes the same way; Ctrl-click on a link joins once its page shows', async ({
    context,
    server,
    call,
    worker,
  }) => {
    const acme = await addAcme(call, server);
    const { alice } = await aliceAndBob(context, acme);
    const lane = await openLane(context, call as Call, { appId: acme.id, accountId: alice.id });
    await lane.page.goto(`${acme.origin}/opener?target=_self`);
    server.log.length = 0;

    let opened = context.waitForEvent('page');
    await lane.page.locator('#submit').click({ modifiers: ['ControlOrMeta'] });
    const posted = await opened;
    expect(await echoOf(posted)).toMatchObject({ method: 'POST' });
    const posts = server.log.filter((item) => item.path.includes('via=form'));
    expect(posts.map((item) => [item.method, item.cookie.includes(ALICE)])).toEqual([['POST', true]]);
    // The lane page itself stayed where it was.
    expect(lane.page.url()).toContain('/opener');

    // A link the browser opens itself: a GET, then loaded again in the lane.
    opened = context.waitForEvent('page');
    await lane.page.locator('#link').click({ modifiers: ['ControlOrMeta'] });
    const linked = await opened;
    await expect.poll(async () => (await echoOf(linked)).cookie).toContain(ALICE);
    await expect.poll(async () => (await lanes(worker))[0]?.tabIds.length).toBe(3);
  });

  test('a form posted twice into the same named window: a new one first, then the one already open', async ({
    context,
    server,
    call,
    worker,
  }) => {
    const acme = await addAcme(call, server);
    const { alice } = await aliceAndBob(context, acme);
    const lane = await openLane(context, call as Call, { appId: acme.id, accountId: alice.id });
    await lane.page.goto(`${acme.origin}/opener?target=results`);
    server.log.length = 0;
    const opened = context.waitForEvent('page');
    await lane.page.locator('#submit').click();
    const results = await opened;
    expect(await echoOf(results)).toMatchObject({ method: 'POST', body: 'field=value&button=pressed' });
    await lane.page.locator('input[name=field]').fill('again');
    await lane.page.locator('#submit').click();
    await expect.poll(async () => (await echoOf(results)).body).toBe('field=again&button=pressed');
    const posts = server.log.filter((item) => item.path.includes('via=form'));
    expect(posts.map((item) => [item.method, item.cookie.includes(ALICE), item.referer])).toEqual([
      ['POST', true, `${acme.origin}/opener?target=results`],
      ['POST', true, `${acme.origin}/opener?target=results`],
    ]);
    expect(context.pages().filter((page) => page.url().includes('via=form'))).toHaveLength(1);
    expect((await lanes(worker))[0]?.tabIds).toHaveLength(2);
  });

  test('tabs other pages open while a separate tab is active stay ordinary (Chrome names the active tab their opener)', async ({
    context,
    server,
    call,
    worker,
    openExtensionPage,
  }) => {
    const acme = await addAcme(call, server);
    const { alice } = await aliceAndBob(context, acme);
    const lane = await openLane(context, call as Call, { appId: acme.id, accountId: alice.id });
    await lane.page.bringToFront();

    // A test (or anything) opening a blank tab, then the app in it.
    const fresh = await context.newPage();
    await fresh.goto(`${acme.origin}/dashboard`);
    expect(await whoIsSignedIn(fresh)).toEqual(signedInAs('bob@acme.test'));

    // An extension page opening the app with window.open.
    const manager = await openExtensionPage('options/options.html');
    await lane.page.bringToFront();
    const opened = context.waitForEvent('page');
    await manager.evaluate((url) => void window.open(url, '_blank'), `${acme.origin}/dashboard?from=extension`);
    const fromExtension = await opened;
    await fromExtension.locator('#server-user').waitFor();
    await fromExtension.waitForTimeout(500);
    expect(await whoIsSignedIn(fromExtension)).toEqual(signedInAs('bob@acme.test'));

    expect((await lanes(worker))[0]?.tabIds).toEqual([lane.tabId]);
  });
});

test.describe('frames of a separate tab', () => {
  test('about:blank and srcdoc frames of a lane page read and write its cookies', async ({
    context,
    server,
    call,
    worker,
  }) => {
    const acme = await addAcme(call, server);
    const { alice } = await aliceAndBob(context, acme);
    const lane = await openLane(context, call as Call, { appId: acme.id, accountId: alice.id });
    const result = await lane.page.evaluate(async () => {
      const blank = document.createElement('iframe');
      document.body.append(blank);
      const read = blank.contentDocument!.cookie;
      blank.contentDocument!.cookie = 'from_blank=1; path=/';
      const srcdoc = document.createElement('iframe');
      srcdoc.srcdoc = '<script>document.cookie = "from_srcdoc=1; path=/";</script>';
      await new Promise((resolve) => {
        srcdoc.onload = resolve;
        document.body.append(srcdoc);
      });
      return { read };
    });
    expect(result.read).toContain(`acme_user=${encodeURIComponent('alice@acme.test')}`);
    // The lane took both (the page sees them once the worker has them), the browser's cookies neither.
    await expect
      .poll(async () => names(await lane.page.evaluate(() => document.cookie)))
      .toEqual(expect.arrayContaining(['from_blank', 'from_srcdoc']));
    await reloadAndRead(lane.page);
    expect(names(await lane.page.evaluate(() => document.cookie))).toEqual(
      expect.arrayContaining(['from_blank', 'from_srcdoc']),
    );
    expect((await browserCookies(worker)).some((cookie) => cookie.startsWith('from_'))).toBe(false);
  });
});

test.describe('ordinary tabs beside a separate tab', () => {
  test("a tab open before the lane started never sees, lists or clears the lane's data", async ({
    context,
    server,
    call,
  }) => {
    // localhost: a secure context (Web Locks).
    const acme = await addAcme(call, server, { host: 'localhost' });
    const { site, alice } = await aliceAndBob(context, acme);
    // Open (and holding on to its storage) before any lane existed.
    await site.evaluate(() => ((window as unknown as { kept: Storage }).kept = localStorage));
    const lane = await openLane(context, call as Call, { appId: acme.id, accountId: alice.id });
    await lane.page.evaluate(async () => {
      await new Promise((resolve) => (indexedDB.open('lane-db').onsuccess = resolve));
      void navigator.locks.request('lane-lock', () => new Promise(() => undefined));
    });

    const seen = await site.evaluate(async () => {
      const kept = (window as unknown as { kept: Storage }).kept;
      return {
        keys: Object.keys(localStorage),
        length: localStorage.length,
        keptLength: kept.length,
        keptKeys: [0, 1, 2].map((index) => kept.key(index)),
        databases: (await indexedDB.databases()).map((info) => info.name),
        locks: (await navigator.locks.query()).held?.map((info) => info.name),
      };
    });
    expect(seen).toEqual({
      keys: ['sb-acme-auth-token'],
      length: 1,
      keptLength: 1,
      keptKeys: ['sb-acme-auth-token', null, null],
      databases: [],
      locks: [],
    });
    // Its clear() (through the Storage it kept, too) removes only its own.
    await site.evaluate(() => {
      (window as unknown as { kept: Storage }).kept.clear();
      localStorage.clear();
    });
    expect(await reloadAndRead(lane.page)).toEqual(signedInAs('alice@acme.test'));
    // The lane still lists its own.
    expect(
      await lane.page.evaluate(async () => ({
        databases: (await indexedDB.databases()).map((info) => info.name),
        locks: (await navigator.locks.query()).held?.map((info) => info.name),
      })),
    ).toEqual({ databases: ['lane-db'], locks: [] });
  });
});

test.describe('a separate tab replaced by Chrome', () => {
  test('a discarded lane tab stays in the lane and loads with its cookies', async ({
    context,
    server,
    call,
    worker,
  }) => {
    const acme = await addAcme(call, server);
    const { site, alice } = await aliceAndBob(context, acme);
    const lane = await openLane(context, call as Call, { appId: acme.id, accountId: alice.id });
    await lane.page.goto(`${acme.origin}/echo-page?before=discard`);
    await site.bringToFront();
    const discarded = await worker.evaluate(async (id) => (await chrome.tabs.discard(id))?.id, lane.tabId);
    expect(discarded).toBeDefined();
    expect(discarded).not.toBe(lane.tabId);
    await expect.poll(async () => (await lanes(worker))[0]?.tabIds).toEqual([discarded]);
    server.log.length = 0;
    await worker.evaluate((id) => chrome.tabs.update(id, { active: true }), discarded!);
    await expect.poll(() => server.log.filter((item) => item.path.includes('before=discard')).length).toBe(1);
    expect(server.log.find((item) => item.path.includes('before=discard'))!.cookie).toContain(ALICE);
  });

  test("a page put in a lane tab's place (prerendered) loads again with the lane's cookies", async ({
    context,
    server,
    call,
    worker,
    tabIdOf,
  }) => {
    const acme = await addAcme(call, server);
    const { alice } = await aliceAndBob(context, acme);
    const lane = await openLane(context, call as Call, { appId: acme.id, accountId: alice.id });
    // A page loaded in a tab of its own (with the browser's cookies), that Chrome then swaps in.
    const prerendered = await context.newPage();
    await prerendered.goto(`${acme.origin}/dashboard`);
    expect(await whoIsSignedIn(prerendered)).toEqual(signedInAs('bob@acme.test'));
    const added = await tabIdOf(prerendered);
    await worker.evaluate(
      ([newId, oldId]) =>
        (
          globalThis as unknown as { swapdeckTest: { replaceTabForTest: (a: number, b: number) => Promise<void> } }
        ).swapdeckTest.replaceTabForTest(newId!, oldId!),
      [added, lane.tabId],
    );
    await expect(prerendered.locator('#server-user')).toHaveText('alice@acme.test');
    expect(await whoIsSignedIn(prerendered)).toEqual(signedInAs('alice@acme.test'));
    expect((await lanes(worker))[0]?.tabIds).toEqual([added]);
  });
});

test.describe("a separate tab's calls to another origin of the app", () => {
  test("XHR there never reads or feeds the browser's HTTP cache, and behaves as XHR", async ({
    context,
    server,
    call,
  }) => {
    const acme = await addAcme(call, server);
    const { site, alice } = await aliceAndBob(context, acme);
    const lane = await openLane(context, call as Call, { appId: acme.id, accountId: alice.id });
    await lane.page.evaluate(() => (document.cookie = 'acme_api=lane; domain=acme.test; path=/'));
    const api = server.url('api.acme.test', '/echo?cache=1');
    const xhr = (page: Page, query: string) =>
      page.evaluate((url) => {
        const events: string[] = [];
        return new Promise<{ cookie: string; events: string[]; status: number; type: string; url: string }>(
          (resolve, reject) => {
            const request = new XMLHttpRequest();
            request.open('GET', url);
            request.responseType = 'json';
            request.onreadystatechange = () => events.push(`state${request.readyState}`);
            for (const type of ['loadstart', 'load', 'loadend'])
              request.addEventListener(type, () => events.push(type));
            request.onloadend = () =>
              resolve({
                cookie: (request.response as { cookie: string }).cookie,
                events,
                status: request.status,
                type: request.getResponseHeader('content-type') ?? '',
                url: request.responseURL,
              });
            request.onerror = () => reject(new Error('xhr failed'));
            request.send();
          },
        );
      }, `${api}&${query}`);
    const hits = () => server.log.filter((item) => item.host === 'api.acme.test').length;

    const before = hits();
    const first = await xhr(lane.page, 'n=1');
    expect(first).toMatchObject({ cookie: 'acme_api=lane', status: 200, type: 'application/json' });
    expect(first.url).toContain('/echo?cache=1&n=1');
    expect(first.events.filter((event) => !event.startsWith('state3'))).toEqual([
      'loadstart',
      'state2',
      'state4',
      'load',
      'loadend',
    ]);
    // The browser's tab gets its own answer, not the lane's (and the other way round).
    expect((await xhr(site, 'n=1')).cookie).toBe('');
    expect((await xhr(site, 'n=2')).cookie).toBe('');
    expect((await xhr(lane.page, 'n=2')).cookie).toBe('acme_api=lane');
    expect(hits() - before).toBe(4);

    // Errors, abort and text answers as XHR has them.
    const edge = await lane.page.evaluate(
      async (base) => {
        const failed = await new Promise<string>((resolve) => {
          const request = new XMLHttpRequest();
          request.open('GET', `${base}/plain`);
          request.onerror = () => resolve(`error ${request.status} ${request.readyState}`);
          request.onload = () => resolve('load');
          request.send();
        });
        const aborted = await new Promise<string>((resolve) => {
          const request = new XMLHttpRequest();
          const seen: string[] = [];
          request.open('GET', `${base}/echo?abort=1`);
          request.onabort = () => seen.push('abort');
          request.onloadend = () => seen.push('loadend');
          request.send();
          request.abort();
          resolve(`${seen.join(',')} ${request.readyState} ${request.status}`);
        });
        const text = await new Promise<string>((resolve) => {
          const request = new XMLHttpRequest();
          request.open('GET', `${base}/echo?text=1`);
          request.onload = () =>
            resolve(`${typeof request.responseText} ${request.getAllResponseHeaders().includes('content-type: ')}`);
          request.send();
        });
        return { failed, aborted, text };
      },
      server.url('api.acme.test', '').replace(/\/$/, ''),
    );
    expect(edge).toEqual({ failed: 'error 0 4', aborted: 'abort,loadend 0 0', text: 'string true' });
  });
});

test.describe('SameSite in a separate tab', () => {
  test("follows each cookie's SameSite, and other sites' calls carry no cookie", async ({
    context,
    server,
    call,
    worker,
  }) => {
    // localhost: a secure context, where SameSite=None (which needs Secure) is kept.
    const acme = await addAcme(call, server, { host: 'localhost' });
    const { alice } = await aliceAndBob(context, acme);
    const lane = await openLane(context, call as Call, { appId: acme.id, accountId: alice.id });
    await lane.page.goto(`${acme.origin}/samesite`);
    await lane.page.locator('#set').waitFor();
    const echo = `${acme.origin}/echo`;
    const all = ['acme_sid', 'acme_user', 'ss_default', 'ss_lax', 'ss_none', 'ss_strict'];
    const lastCookies = (part: string) =>
      names([...server.log].reverse().find((item) => item.path.includes(part))!.cookie);

    // The app's own requests: every cookie.
    expect(
      names(
        await lane.page.evaluate(
          (url) =>
            fetch(url)
              .then((r) => r.json())
              .then((j) => j.cookie),
          echo,
        ),
      ),
    ).toEqual(all);

    // Another site's page in the lane tab: its frame of the app gets only None cookies; its calls none at all.
    await lane.page.goto(
      server.url('other.test', `/embedder?frame=${encodeURIComponent(`${acme.origin}/echo-page?in=frame`)}`),
    );
    await expect.poll(() => server.log.some((item) => item.path.includes('in=frame'))).toBe(true);
    expect(lastCookies('in=frame')).toEqual(['ss_none']);
    const read = await lane.page.evaluate(
      (url) =>
        Promise.all([
          fetch(`${url}?from=other`).then((r) => r.json()),
          fetch(`${url}?from=other-credentials`, { credentials: 'include' }).then(
            (r) => r.json(),
            () => ({ cookie: 'blocked' }),
          ),
        ]),
      echo,
    );
    expect(read.map((item: { cookie: string }) => item.cookie)).toEqual(['', 'blocked']);
    expect(lastCookies('from=other-credentials')).toEqual([]);
    await lane.page.evaluate((url) => {
      const image = new Image();
      image.src = `${url}?from=image`;
    }, echo);
    await expect.poll(() => server.log.some((item) => item.path.includes('from=image'))).toBe(true);
    expect(lastCookies('from=image')).toEqual(['ss_none']);
    // Its frame of the app is a cross-site context: its own calls get only None cookies (Chrome 145+).
    const frame = lane.page.frames().find((item) => item.url().includes('in=frame'))!;
    await frame.evaluate((url) => fetch(`${url}?from=frame`), echo);
    expect(lastCookies('from=frame')).toEqual(['ss_none']);

    // A link from that site: Lax goes, Strict stays behind. A form posted from it: only None.
    await lane.page.evaluate((url) => (location.href = url), `${acme.origin}/echo-page?via=cross-link`);
    expect(names((await echoOf(lane.page)).cookie)).toEqual([
      'acme_sid',
      'acme_user',
      'ss_default',
      'ss_lax',
      'ss_none',
    ]);
    await lane.page.goto(server.url('other.test', '/plain'));
    await lane.page.evaluate((url) => {
      const form = document.createElement('form');
      form.method = 'post';
      form.action = url;
      document.body.append(form);
      form.submit();
    }, `${acme.origin}/echo-page?via=cross-post`);
    // (and, as Chrome allows for two minutes, a cookie set just now without SameSite)
    expect(names((await echoOf(lane.page)).cookie)).toEqual(['ss_default', 'ss_none']);

    // Typed in the address bar (no page started it): every cookie, as Chrome sends them.
    await lane.page.goto(`${acme.origin}/echo-page?via=typed`);
    await expect.poll(async () => names((await echoOf(lane.page)).cookie)).toEqual(all);
    // Opened by Swapdeck in another tab of the lane: every cookie on the first request.
    server.log.length = 0;
    const second = await call<{ tabId: number }>('lane.open', {
      appId: acme.id,
      accountId: alice.id,
      url: `${acme.origin}/echo-page?via=swapdeck`,
    });
    expect(second.ok).toBe(true);
    await expect.poll(() => server.log.filter((item) => item.path.includes('via=swapdeck')).length).toBe(1);
    expect(lastCookies('via=swapdeck')).toEqual(all);
    // The browser's own cookies never got any of them.
    expect((await browserCookies(worker, 'localhost')).some((cookie) => cookie.startsWith('ss_'))).toBe(false);
  });
});
