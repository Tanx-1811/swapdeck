import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { activeAccount, addAcme, readExtensionStorage, signIn, storedAccounts } from './helpers';

type StoredAccount = {
  id: string;
  email?: string;
  recents: { key: string }[];
  expiredAt?: number;
  capturedAt?: number;
};

/**
 * Answers Swapdeck's link card with the keyboard, as a person would (its closed
 * shadow root keeps the page — and tests — from clicking it directly): Tab into
 * the card (its close button comes first), then to "Not now", "Always switch"
 * or "Switch", and Enter.
 */
async function answerLinkCard(page: Page, answer: 'no' | 'always' | 'switch') {
  await expect(page.locator('#swapdeck-link')).toBeAttached();
  for (let presses = 0; presses < 20; presses++) {
    await page.keyboard.press('Tab');
    if (await page.evaluate(() => document.activeElement?.id === 'swapdeck-link')) break;
  }
  for (let presses = 0; presses < { no: 1, always: 2, switch: 3 }[answer]; presses++) await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page.locator('#swapdeck-link')).toHaveCount(0);
}

test.describe('links of another account', () => {
  test('offers to switch to the account a page belongs to, and reopens that page', async ({
    context,
    server,
    call,
  }) => {
    const acme = await addAcme(call, server, { recentPattern: '^/project/([a-z0-9]+)', titleSuffix: ' | Acme' });
    const site = await context.newPage();
    await signIn(site, acme.origin, 'alice@acme.test');
    await site.goto(`${acme.origin}/project/alpha`);
    await expect
      .poll(
        async () =>
          ((await storedAccounts(context, acme.id))[0] as unknown as StoredAccount | undefined)?.recents.length,
      )
      .toBe(1);
    expect((await call('fresh', { appId: acme.id })).ok).toBe(true);
    await signIn(site, acme.origin, 'bob@acme.test');
    await expect.poll(() => storedAccounts(context, acme.id)).toHaveLength(2);
    const alice = (await storedAccounts(context, acme.id)).find((account) => account.email === 'alice@acme.test')!;

    // A link to Alice's project, opened while Bob is in use (say, from a chat).
    const link = await context.newPage();
    await link.goto(`${acme.origin}/project/alpha`);
    await answerLinkCard(link, 'switch');
    await expect(link.locator('#server-user')).toHaveText('alice@acme.test');
    await expect(link).toHaveURL(`${acme.origin}/project/alpha`);
    expect(await activeAccount(context, acme.id)).toBe(alice.id);
  });

  test('"Not now" stops asking about a page the account in use opens too', async ({ context, server, call }) => {
    const acme = await addAcme(call, server, { recentPattern: '^/project/([a-z0-9]+)', titleSuffix: ' | Acme' });
    const site = await context.newPage();
    await signIn(site, acme.origin, 'alice@acme.test');
    await site.goto(`${acme.origin}/project/alpha`);
    await expect
      .poll(
        async () =>
          ((await storedAccounts(context, acme.id))[0] as unknown as StoredAccount | undefined)?.recents.length,
      )
      .toBe(1);
    expect((await call('fresh', { appId: acme.id })).ok).toBe(true);
    await signIn(site, acme.origin, 'bob@acme.test');
    await expect.poll(() => storedAccounts(context, acme.id)).toHaveLength(2);

    await site.goto(`${acme.origin}/project/alpha`);
    await answerLinkCard(site, 'no');
    await expect(site.locator('#server-user')).toHaveText('bob@acme.test');
    // Bob opens it too now: a shared project, nothing to ask about any more.
    await expect
      .poll(async () => {
        const accounts = (await storedAccounts(context, acme.id)) as unknown as StoredAccount[];
        return accounts.find((account) => account.email === 'bob@acme.test')?.recents.map((item) => item.key);
      })
      .toEqual(['alpha']);
    await site.reload();
    await site.waitForTimeout(1200);
    await expect(site.locator('#swapdeck-link')).toHaveCount(0);
  });

  test('follows the links an account was given, at once when set to switch right away', async ({
    context,
    server,
    call,
  }) => {
    const acme = await addAcme(call, server);
    const site = await context.newPage();
    await signIn(site, acme.origin, 'alice@acme.test');
    await expect.poll(() => storedAccounts(context, acme.id)).toHaveLength(1);
    expect((await call('fresh', { appId: acme.id })).ok).toBe(true);
    await signIn(site, acme.origin, 'bob@acme.test');
    await expect.poll(() => storedAccounts(context, acme.id)).toHaveLength(2);
    const alice = (await storedAccounts(context, acme.id)).find((account) => account.email === 'alice@acme.test')!;
    const update = await call('account.update', { id: alice.id, patch: { linkRules: ['acme.test/project/billing'] } });
    expect(update.ok).toBe(true);
    expect((await call('settings.update', { patch: { linkRouting: 'auto' } })).ok).toBe(true);

    const link = await context.newPage();
    await link.goto(`${acme.origin}/project/billing`);
    await expect(link.locator('#server-user')).toHaveText('alice@acme.test');
    await expect(link).toHaveURL(`${acme.origin}/project/billing`);
    // Pages outside the rule stay with the account in use.
    const other = await context.newPage();
    await other.goto(`${acme.origin}/project/other`);
    await other.waitForTimeout(1200);
    await expect(other.locator('#swapdeck-link')).toHaveCount(0);
    expect(await activeAccount(context, acme.id)).toBe(alice.id);
  });
});

test.describe('expired sessions', () => {
  test('marks an account whose saved session no longer signs in, and clears it after signing in again', async ({
    context,
    server,
    call,
    openPopup,
    openExtensionPage,
  }) => {
    const acme = await addAcme(call, server);
    const site = await context.newPage();
    await signIn(site, acme.origin, 'alice@acme.test');
    await expect.poll(() => storedAccounts(context, acme.id)).toHaveLength(1);
    expect((await call('fresh', { appId: acme.id })).ok).toBe(true);
    await signIn(site, acme.origin, 'bob@acme.test');
    await expect.poll(() => storedAccounts(context, acme.id)).toHaveLength(2);
    const alice = (await storedAccounts(context, acme.id)).find((account) => account.email === 'alice@acme.test')!;

    // The site ended Alice's session meanwhile: her saved copy signs in nobody.
    const [worker] = context.serviceWorkers();
    await worker!.evaluate(async (id) => {
      const key = `sd:snap:${id}`;
      const stored = (await chrome.storage.local.get(key))[key] as { plain: { cookies: unknown[]; storage: object } };
      stored.plain.cookies = [];
      stored.plain.storage = { localStorage: {} };
      await chrome.storage.local.set({ [key]: stored });
    }, alice.id);
    expect((await call('switch', { appId: acme.id, accountId: alice.id })).ok).toBe(true);
    await expect(site.locator('#server-user')).toHaveText('nobody');
    await expect
      .poll(
        async () =>
          ((await readExtensionStorage<StoredAccount[]>(context, 'sd:accounts')) ?? []).find(
            (account) => account.id === alice.id,
          )?.expiredAt,
        { timeout: 10_000 },
      )
      .toBeGreaterThan(0);

    const popup = await openPopup(site);
    await expect(popup.getByRole('listitem').filter({ hasText: 'Alice Nguyen' })).toContainText('Expired');
    const overview = await openExtensionPage('options/options.html#/');
    await expect(overview.locator('section', { has: overview.locator('#relogin') })).toContainText('Alice Nguyen');

    // Signing in as Alice again saves the new session under her account at once.
    await signIn(site, acme.origin, 'alice@acme.test');
    await expect
      .poll(async () => {
        const account = ((await readExtensionStorage<StoredAccount[]>(context, 'sd:accounts')) ?? []).find(
          (item) => item.id === alice.id,
        );
        return Boolean(account && !account.expiredAt);
      })
      .toBe(true);
    await expect(overview.locator('#relogin')).toHaveCount(0);
    await popup.reload();
    await expect(popup.getByRole('listitem').filter({ hasText: 'Alice Nguyen' })).not.toContainText('Expired');
  });
});

test.describe('open link as', () => {
  test('switches in a blank tab first, so the link is never requested with the account in use', async ({
    context,
    server,
    call,
    worker,
  }) => {
    const acme = await addAcme(call, server);
    const site = await context.newPage();
    await signIn(site, acme.origin, 'alice@acme.test');
    await expect.poll(() => storedAccounts(context, acme.id)).toHaveLength(1);
    expect((await call('fresh', { appId: acme.id })).ok).toBe(true);
    await signIn(site, acme.origin, 'bob@acme.test');
    await expect.poll(() => storedAccounts(context, acme.id)).toHaveLength(2);
    const alice = (await storedAccounts(context, acme.id)).find((account) => account.email === 'alice@acme.test')!;

    // What "Open link as → Alice" does once it has opened its blank tab next to the page.
    const opened = context.waitForEvent('page');
    const blankId = await worker.evaluate(
      async () => (await chrome.tabs.create({ url: 'about:blank', active: false })).id!,
    );
    const blank = await opened;
    const link = `${acme.origin}/project/invite`;
    const sentWith: string[] = [];
    blank.on('request', (request) => {
      if (request.url() !== link) return;
      void request.allHeaders().then((headers) => sentWith.push(decodeURIComponent(headers.cookie ?? '')));
    });
    const plan = {
      kind: 'account',
      appId: acme.id,
      accountId: alice.id,
      tabId: blankId,
      url: link,
      focus: true,
      blankTab: true,
    };
    expect((await call('switch.guarded', { plan })).ok).toBe(true);

    await expect(blank).toHaveURL(link);
    await expect(blank.locator('#server-user')).toHaveText('alice@acme.test');
    expect(sentWith.length).toBeGreaterThan(0);
    for (const cookies of sentWith) expect(cookies).not.toContain('bob@acme.test');
    expect(await activeAccount(context, acme.id)).toBe(alice.id);
  });
});
