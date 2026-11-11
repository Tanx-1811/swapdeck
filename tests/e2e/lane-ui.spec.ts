import type { BrowserContext, Page, Worker } from '@playwright/test';
import { expect, test } from './fixtures';
import { activeAccount, addAcme, signIn, signOutByHand, storedAccounts } from './helpers';

/*
 * Separate tabs (lanes) as the popup and the manager show them: closing one asks about unsaved
 * work in its tabs, the manager lists every one open (scratch tabs too) and follows them, and the
 * popup in a separate tab says which tabs its actions change.
 */

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

type TabIdOf = (page: Page) => Promise<number>;

/** Opens a lane through the worker; its page is found by its tab (pages of several lanes come in any order). */
async function openLane(context: BrowserContext, call: Call, tabIdOf: TabIdOf, payload: Record<string, unknown>) {
  const result = await call<{ token: string; tabId: number }>('lane.open', payload);
  expect(result.ok, `${result.error} ${result.detail ?? ''}`).toBe(true);
  const { token, tabId } = result.data!;
  let page: Page | null = null;
  await expect
    .poll(async () => {
      for (const candidate of context.pages()) {
        if (!candidate.url().startsWith('http')) continue;
        if ((await tabIdOf(candidate).catch(() => -1)) === tabId) page = candidate;
      }
      return page !== null;
    })
    .toBe(true);
  await page!.locator('#server-user').waitFor();
  return { page: page!, token, tabId };
}

async function lanes(worker: Worker) {
  return worker.evaluate(async () => {
    const raw = (await chrome.storage.session.get('sd:lanes'))['sd:lanes'] as
      | { lanes: Record<string, { token: string; kind: string; accountId: string | null; tabIds: number[] }> }
      | undefined;
    return Object.values(raw?.lanes ?? {});
  });
}

/**
 * A new tab of ours, opened from an ordinary tab: Chrome gives a new blank tab the active one as its
 * opener, and a blank tab a separate tab opened joins it.
 */
async function pageBeside(context: BrowserContext, ordinary: Page, url: string): Promise<Page> {
  await ordinary.bringToFront();
  const page = await context.newPage();
  await page.goto(url);
  await page.locator('html[data-ready]').waitFor({ state: 'attached' });
  return page;
}

test.describe('closing a separate tab', () => {
  test('asks about unsaved work in its tabs, from the popup in it and from the manager', async ({
    context,
    server,
    call,
    worker,
    extensionId,
    tabIdOf,
  }) => {
    const acme = await addAcme(call, server);
    const { site, alice } = await aliceAndBob(context, acme);
    const lane = await openLane(context, call as Call, tabIdOf, { appId: acme.id, accountId: alice.id });
    await lane.page.goto(`${acme.origin}/editor`);
    await lane.page.locator('#draft').fill('select * from half_written');

    const popup = await pageBeside(
      context,
      site,
      `chrome-extension://${extensionId}/popup/popup.html?tab=${lane.tabId}`,
    );
    await popup.getByRole('button', { name: 'Close separate tab' }).click();
    const dialog = popup.getByRole('dialog', { name: 'Unsaved work' });
    await expect(dialog).toContainText('Closing the separate tab closes these tabs');
    await expect(dialog).toContainText('Editor | Acme — edited form');
    if (process.env.SHOTS) await popup.screenshot({ path: `${process.env.SHOTS}/popup-lane-close-unsaved.png` });
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    // Cancelled: the separate tab and what is typed there stay.
    await expect(dialog).toHaveCount(0);
    expect(await lanes(worker)).toHaveLength(1);
    await expect(lane.page.locator('#draft')).toHaveValue('select * from half_written');

    // The manager's list asks the same, and "Close anyway" closes it.
    const manager = await pageBeside(context, site, `chrome-extension://${extensionId}/options/options.html#/`);
    const row = manager.locator(`[data-lane="${lane.token}"]`);
    await row.getByRole('button', { name: `Close: ${alice.label} · Acme` }).click();
    const asked = manager.getByRole('dialog', { name: 'Unsaved work' });
    await expect(asked).toContainText('Editor | Acme — edited form');
    await asked.getByRole('button', { name: 'Cancel' }).click();
    expect(await lanes(worker)).toHaveLength(1);
    await row.getByRole('button', { name: `Close: ${alice.label} · Acme` }).click();
    await asked.getByRole('button', { name: 'Close anyway' }).click();
    await expect.poll(async () => (await lanes(worker)).length).toBe(0);
    await expect(row).toHaveCount(0);
    expect(lane.page.isClosed()).toBe(true);
    // The browser's own tabs kept their account.
    expect(await tabIdOf(site)).toBeGreaterThan(0);
    await expect(site.locator('#server-user')).toHaveText('bob@acme.test');
  });

  test('closes at once when nothing would be lost, and asks about a scratch sign-in nobody saved', async ({
    context,
    server,
    call,
    worker,
    extensionId,
    tabIdOf,
  }) => {
    const acme = await addAcme(call, server);
    const { site, alice } = await aliceAndBob(context, acme);
    const lane = await openLane(context, call as Call, tabIdOf, { appId: acme.id, accountId: alice.id });
    const scratch = await openLane(context, call as Call, tabIdOf, { appId: acme.id, accountId: null });
    await signIn(scratch.page, acme.origin, 'carol@acme.test');

    const manager = await pageBeside(
      context,
      site,
      `chrome-extension://${extensionId}/options/options.html#/apps/${acme.id}`,
    );
    // The account's menu closes it too; with nothing unsaved, without a question.
    await manager.locator(`[data-account="${alice.id}"] button[aria-haspopup]`).click();
    await manager.getByRole('menuitem', { name: 'Close separate tab' }).click();
    await expect.poll(async () => (await lanes(worker)).map((item) => item.token)).toEqual([scratch.token]);
    expect(lane.page.isClosed()).toBe(true);
    await expect(manager.getByRole('dialog')).toHaveCount(0);

    await expect(manager.locator(`[data-lane="${scratch.token}"]`)).toContainText('Signed in as carol@acme.test');
    await manager.getByRole('button', { name: 'Close: Scratch 1' }).click();
    const dialog = manager.getByRole('dialog', { name: 'Close the scratch tab?' });
    await expect(dialog).toContainText('carol@acme.test is signed in there and not saved');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    expect(await lanes(worker)).toHaveLength(1);
  });
});

test.describe('separate tabs in the manager', () => {
  test('lists the open ones, scratch tabs too, and follows them as they open, change and close', async ({
    context,
    server,
    call,
    worker,
    extensionId,
    tabIdOf,
  }) => {
    const acme = await addAcme(call, server);
    const { site, alice } = await aliceAndBob(context, acme);
    const manager = await pageBeside(context, site, `chrome-extension://${extensionId}/options/options.html#/`);
    const card = manager.locator('section', { has: manager.locator('#separate-tabs') });
    await expect(card).toHaveCount(0);

    const lane = await openLane(context, call as Call, tabIdOf, { appId: acme.id, accountId: alice.id });
    const laneRow = card.locator(`[data-lane="${lane.token}"]`);
    await expect(laneRow).toContainText(alice.label);
    await expect(laneRow).toContainText('Acme · 1 tab');
    await expect(laneRow).toContainText('Signed in as alice@acme.test');
    // An account's separate tab has nothing to save by hand.
    await expect(laneRow.getByRole('button', { name: /Save as account/ })).toHaveCount(0);

    const scratch = await openLane(context, call as Call, tabIdOf, { appId: acme.id, accountId: null });
    const scratchRow = card.locator(`[data-lane="${scratch.token}"]`);
    await expect(scratchRow).toContainText('Scratch 1');
    await expect(scratchRow).toContainText('Nobody signed in yet');
    await signIn(scratch.page, acme.origin, 'carol@acme.test');
    await expect(scratchRow).toContainText('Signed in as carol@acme.test');

    // A page the separate tab opens joins it: the count follows. (From the tab in front, as with a click:
    // Chrome makes the active tab the opener.)
    await lane.page.bringToFront();
    const child = context.waitForEvent('page');
    await lane.page.evaluate((url) => void window.open(url, '_blank'), `${acme.origin}/project/abc123`);
    await (await child).locator('#server-user').waitFor();
    await expect(laneRow).toContainText('Acme · 2 tabs');

    // Show brings its tab to the front.
    await manager.bringToFront();
    await laneRow.getByRole('button', { name: `Show: ${alice.label} · Acme` }).click();
    await expect
      .poll(() => worker.evaluate(async (tabId) => (await chrome.tabs.get(tabId)).active, lane.tabId))
      .toBe(true);

    // The app's page lists its own separate tabs, without the app's name.
    await manager.goto(`chrome-extension://${extensionId}/options/options.html#/apps/${acme.id}`);
    await expect(card.locator('[data-lane]')).toHaveCount(2);
    await expect(card.locator(`[data-lane="${lane.token}"]`)).toContainText('2 tabs');
    await expect(card.locator(`[data-lane="${lane.token}"]`)).not.toContainText('Acme ·');
    if (process.env.SHOTS) await manager.screenshot({ path: `${process.env.SHOTS}/manager-app-lanes.png` });

    // A scratch sign-in saved from the list becomes that account's separate tab.
    await card.getByRole('button', { name: 'Save as account: Scratch 1' }).click();
    await expect(manager.getByRole('status')).toContainText('Saved as');
    await expect.poll(async () => (await storedAccounts(context, acme.id)).length).toBe(3);
    const carol = (await storedAccounts(context, acme.id)).find((account) => account.email === 'carol@acme.test')!;
    await expect(card.locator(`[data-lane="${scratch.token}"]`)).toContainText(carol.label);
    await expect(card.locator(`[data-lane="${scratch.token}"] button`, { hasText: 'Save as account' })).toHaveCount(0);

    // Closing its last tab elsewhere ends it: the list follows.
    await scratch.page.close();
    await expect(card.locator(`[data-lane="${scratch.token}"]`)).toHaveCount(0);
    await expect(card.locator('[data-lane]')).toHaveCount(1);
  });
});

test.describe('the popup in a separate tab', () => {
  test('says which tabs its actions change, and offers another account in a scratch tab', async ({
    context,
    server,
    call,
    worker,
    extensionId,
    tabIdOf,
  }) => {
    const acme = await addAcme(call, server);
    const { site, alice, bob } = await aliceAndBob(context, acme);
    const lane = await openLane(context, call as Call, tabIdOf, { appId: acme.id, accountId: alice.id });

    const popup = await pageBeside(
      context,
      site,
      `chrome-extension://${extensionId}/popup/popup.html?tab=${lane.tabId}`,
    );
    // The account list acts on the other tabs, and says so.
    await expect(popup.getByRole('heading', { name: 'Your other Acme tabs' })).toBeVisible();
    await expect(popup.getByRole('list', { name: 'Your other Acme tabs' })).toBeVisible();
    await expect(popup.getByText('Switching here changes those tabs, not this separate tab.')).toBeVisible();
    // Nothing acts on the other tabs without saying so: no plain "Open", no plain "another account".
    await expect(popup.locator('.app-head').getByRole('button', { name: 'Open', exact: true })).toHaveCount(0);
    await expect(popup.getByRole('button', { name: 'Sign in with another account' })).toHaveCount(0);
    await popup.locator('.app-head').getByRole('button', { name: 'More actions' }).click();
    await expect(popup.getByRole('menuitem', { name: 'Open Acme in an ordinary tab' })).toBeVisible();
    await popup.keyboard.press('Escape');

    const opened = context.waitForEvent('page');
    await popup.getByRole('button', { name: 'Another account in a scratch tab' }).click();
    const scratch = await opened;
    await scratch.locator('#server-user', { hasText: 'nobody' }).waitFor();
    await expect
      .poll(async () => (await lanes(worker)).map((item) => item.kind).sort())
      .toEqual(['account', 'scratch']);
    // The browser's own tabs and this separate tab are as they were.
    expect(await activeAccount(context, acme.id)).toBe(bob.id);
    await expect(site.locator('#server-user')).toHaveText('bob@acme.test');
    await lane.page.reload();
    await expect(lane.page.locator('#server-user')).toHaveText('alice@acme.test');
  });

  test('outside a separate tab, keeps "Sign in with another account" and offers the menu hint', async ({
    context,
    server,
    call,
    openPopup,
  }) => {
    const acme = await addAcme(call, server);
    const { site, alice } = await aliceAndBob(context, acme);
    const popup = await openPopup(site);
    await expect(popup.getByRole('button', { name: 'Sign in with another account' })).toBeVisible();
    await expect(popup.getByRole('heading', { name: 'Your other Acme tabs' })).toHaveCount(0);
    await popup.getByRole('button', { name: `More actions: ${alice.label}` }).click();
    await expect(popup.getByRole('menuitem', { name: 'Open in a separate tab' })).toHaveAttribute(
      'title',
      'Use this account in a new tab; your other tabs stay as they are',
    );
  });
});

test.describe('importing a sign-in', () => {
  test('says a paste is too large instead of cutting it short', async ({ call, server, openExtensionPage }) => {
    const acme = await addAcme(call, server);
    const manager = await openExtensionPage(`options/options.html#/apps/${acme.id}`);
    await manager.locator('.app-header button[aria-haspopup]').click();
    await manager.getByRole('menuitem', { name: 'Import a sign-in…' }).click();
    const dialog = manager.getByRole('dialog', { name: 'Import a sign-in into Acme' });
    const text = dialog.locator('textarea');
    await expect(text).not.toHaveAttribute('maxlength');
    await text.fill('[{"name":"sid","value":"x"}]');
    await text.fill(`[${'x'.repeat(2_000_001)}]`);
    await expect(dialog.locator('.callout--danger')).toHaveText('This text is too large to be an exported sign-in.');
    // What was there before stays, whole.
    await expect(text).toHaveValue('[{"name":"sid","value":"x"}]');
    await expect(text).toHaveAttribute('aria-invalid', 'true');
    await text.fill('[]');
    await expect(dialog.locator('.callout--danger')).toHaveCount(0);
  });
});
