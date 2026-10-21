import { expect, test } from './fixtures';
import { addAcme, signIn, storedAccounts } from './helpers';

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
});
