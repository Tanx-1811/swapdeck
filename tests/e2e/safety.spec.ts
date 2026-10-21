import { expect, test } from './fixtures';
import { activeAccount, addAcme, signIn, storedAccounts } from './helpers';

test.describe('safety', () => {
  test('important accounts ask before switching and mark their pages', async ({ context, server, call, openPopup }) => {
    const acme = await addAcme(call, server);
    const site = await context.newPage();
    await signIn(site, acme.origin, 'alice@acme.test');
    await expect.poll(() => storedAccounts(context, acme.id)).toHaveLength(1);
    expect((await call('fresh', { appId: acme.id })).ok).toBe(true);
    await signIn(site, acme.origin, 'bob@acme.test');
    await expect.poll(() => storedAccounts(context, acme.id)).toHaveLength(2);
    const alice = (await storedAccounts(context, acme.id)).find((account) => account.email === 'alice@acme.test')!;
    expect((await call('account.update', { id: alice.id, patch: { important: true } })).ok).toBe(true);

    const popup = await openPopup(site);
    await expect(popup.getByRole('listitem').filter({ hasText: 'Alice Nguyen' })).toContainText('Important');

    // Cancelling the confirmation changes nothing.
    await popup.getByRole('button', { name: /switch to alice/i }).click();
    const dialog = popup.getByRole('dialog', { name: 'Switch to an important account?' });
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(site.locator('#server-user')).toHaveText('bob@acme.test');

    await popup.getByRole('button', { name: /switch to alice/i }).click();
    await dialog.getByRole('button', { name: 'Switch' }).click();
    await expect(site.locator('#server-user')).toHaveText('alice@acme.test');
    // The page carries the warning strip while the important account is in use…
    await expect(site.locator('#swapdeck-ribbon')).toBeAttached();

    // …and loses it with an ordinary account (no confirmation needed there).
    await popup.keyboard.press('2');
    await expect(site.locator('#server-user')).toHaveText('bob@acme.test');
    await expect(site.locator('#swapdeck-ribbon')).toHaveCount(0);
  });

  test('reminds to lock saved sign-ins until "Later"', async ({ context, server, call, openPopup }) => {
    const acme = await addAcme(call, server);
    const site = await context.newPage();
    await signIn(site, acme.origin, 'alice@acme.test');
    await expect.poll(() => storedAccounts(context, acme.id)).toHaveLength(1);

    const popup = await openPopup(site);
    const nudge = popup.getByText('Your saved sign-ins are not locked');
    // One saved account is not worth a reminder yet.
    await expect(nudge).toHaveCount(0);

    expect((await call('fresh', { appId: acme.id })).ok).toBe(true);
    await signIn(site, acme.origin, 'bob@acme.test');
    await expect.poll(() => storedAccounts(context, acme.id)).toHaveLength(2);
    await popup.reload();
    await expect(nudge).toBeVisible();
    await popup.getByRole('button', { name: 'Later' }).click();
    await expect(nudge).toHaveCount(0);
    await popup.reload();
    await popup.locator('html[data-ready]').waitFor({ state: 'attached' });
    await expect(nudge).toHaveCount(0);
  });

  test('asks before a switch reloads a tab with unsaved work', async ({ context, server, call, openPopup }) => {
    const acme = await addAcme(call, server);
    const site = await context.newPage();
    await signIn(site, acme.origin, 'alice@acme.test');
    await expect.poll(() => storedAccounts(context, acme.id)).toHaveLength(1);
    expect((await call('fresh', { appId: acme.id })).ok).toBe(true);
    await signIn(site, acme.origin, 'bob@acme.test');
    await expect.poll(() => storedAccounts(context, acme.id)).toHaveLength(2);
    await site.goto(`${acme.origin}/editor`);
    await site.locator('#draft').fill('select * from half_written');

    const popup = await openPopup(site);
    await popup.getByRole('button', { name: /switch to alice/i }).click();
    const dialog = popup.getByRole('dialog', { name: 'Unsaved work' });
    await expect(dialog).toContainText('Editor | Acme — edited form');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(site.locator('#draft')).toHaveValue('select * from half_written');
    await expect(site.locator('#server-user')).toHaveText('bob@acme.test');

    await popup.getByRole('button', { name: /switch to alice/i }).click();
    await dialog.getByRole('button', { name: 'Switch anyway' }).click();
    await expect(site.locator('#server-user')).toHaveText('alice@acme.test');
  });

  test("notices a page's own leave warning", async ({ context, server, call, openPopup }) => {
    const acme = await addAcme(call, server);
    const site = await context.newPage();
    await signIn(site, acme.origin, 'alice@acme.test');
    await expect.poll(() => storedAccounts(context, acme.id)).toHaveLength(1);
    await site.goto(`${acme.origin}/leave`);
    const popup = await openPopup(site);
    await popup.getByRole('button', { name: /sign in with another account/i }).click();
    const dialog = popup.getByRole('dialog', { name: 'Unsaved work' });
    await expect(dialog).toContainText('Unsaved changes | Acme — asks before you leave');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(site.locator('#server-user')).toHaveText('alice@acme.test');
  });

  test('asks on the page before a shortcut switches to an important account', async ({ context, server, call }) => {
    const acme = await addAcme(call, server);
    const site = await context.newPage();
    await signIn(site, acme.origin, 'alice@acme.test');
    await expect.poll(() => storedAccounts(context, acme.id)).toHaveLength(1);
    expect((await call('fresh', { appId: acme.id })).ok).toBe(true);
    await signIn(site, acme.origin, 'bob@acme.test');
    await expect.poll(() => storedAccounts(context, acme.id)).toHaveLength(2);
    const alice = (await storedAccounts(context, acme.id)).find((account) => account.email === 'alice@acme.test')!;
    expect((await call('account.update', { id: alice.id, patch: { important: true } })).ok).toBe(true);
    await site.bringToFront();

    // Escape answers no.
    const first = call<string>('cycle', { step: 1 });
    await expect(site.locator('#swapdeck-ask')).toBeAttached();
    await site.keyboard.press('Escape');
    expect((await first).data).toBe('cancelled');
    await expect(site.locator('#swapdeck-ask')).toHaveCount(0);
    await expect(site.locator('#server-user')).toHaveText('bob@acme.test');

    // Tab moves from Cancel to the confirm button; Enter presses it.
    const second = call<string>('cycle', { step: 1 });
    await expect(site.locator('#swapdeck-ask')).toBeAttached();
    await site.keyboard.press('Tab');
    await site.keyboard.press('Enter');
    expect((await second).data).toBe('done');
    await expect(site.locator('#server-user')).toHaveText('alice@acme.test');
  });

  test("asks in a small window when the page can't show the question", async ({ context, server, call }) => {
    const acme = await addAcme(call, server);
    const site = await context.newPage();
    await signIn(site, acme.origin, 'alice@acme.test');
    await expect.poll(() => storedAccounts(context, acme.id)).toHaveLength(1);
    expect((await call('fresh', { appId: acme.id })).ok).toBe(true);
    await signIn(site, acme.origin, 'bob@acme.test');
    await expect.poll(() => storedAccounts(context, acme.id)).toHaveLength(2);
    const alice = (await storedAccounts(context, acme.id)).find((account) => account.email === 'alice@acme.test')!;
    expect((await call('account.update', { id: alice.id, patch: { important: true } })).ok).toBe(true);

    // The current tab is a blank page, where Swapdeck can't draw anything.
    const blank = await context.newPage();
    await blank.bringToFront();
    const opened = context.waitForEvent('page', (page) => page.url().includes('popup.html?ask='));
    const result = await call<string>('switch.guarded', {
      plan: { kind: 'account', appId: acme.id, accountId: alice.id },
    });
    expect(result.data).toBe('asked');
    const window = await opened;
    await window.locator('html[data-ready]').waitFor({ state: 'attached' });
    await expect(window.getByRole('heading', { name: 'Switch to an important account?' })).toBeVisible();
    await window.getByRole('button', { name: 'Switch' }).click();
    await expect.poll(() => activeAccount(context, acme.id)).toBe(alice.id);
    await expect(site.locator('#server-user')).toHaveText('alice@acme.test');
  });
});
