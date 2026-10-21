import { expect, test } from './fixtures';
import { activeAccount, addAcme, signIn, signOutByHand, storedAccounts, whoIsSignedIn } from './helpers';

const signedInAs = (email: string) => ({ server: email, cookie: email, storage: email });

test.describe('switching accounts', () => {
  test('saves sign-ins automatically and switches every part of the session', async ({
    context,
    server,
    call,
    openPopup,
  }) => {
    const acme = await addAcme(call, server);
    const site = await context.newPage();
    await signIn(site, acme.origin, 'alice@acme.test');

    const popup = await openPopup(site);
    await expect(popup.locator('.status-bar')).toContainText('alice@acme.test');
    await expect(popup.getByRole('listitem').filter({ hasText: 'Alice Nguyen' })).toBeVisible();

    await popup.getByRole('button', { name: /sign in with another account/i }).click();
    await expect(site.locator('#server-user')).toHaveText('nobody');
    expect(await whoIsSignedIn(site)).toEqual({ server: 'nobody', cookie: 'nobody', storage: 'nobody' });
    await signIn(site, acme.origin, 'bob@acme.test');
    await expect(popup.getByRole('listitem').filter({ hasText: 'Bob Tran' })).toBeVisible();
    expect((await storedAccounts(context, acme.id)).map((account) => account.email)).toEqual([
      'alice@acme.test',
      'bob@acme.test',
    ]);

    await popup.getByRole('button', { name: /switch to alice/i }).click();
    await expect(site.locator('#server-user')).toHaveText('alice@acme.test');
    expect(await whoIsSignedIn(site)).toEqual(signedInAs('alice@acme.test'));
    // A confirmation appears on the page once it has loaded.
    await expect(site.locator('#swapdeck-toast')).toBeAttached();

    await popup.keyboard.press('2');
    await expect(site.locator('#server-user')).toHaveText('bob@acme.test');
    expect(await whoIsSignedIn(site)).toEqual(signedInAs('bob@acme.test'));
    await expect(popup.getByRole('button', { name: /^open bob tran/i })).toBeVisible();
  });

  test('never files a session under the wrong account when someone signs in by hand', async ({
    context,
    server,
    call,
    openPopup,
  }) => {
    const acme = await addAcme(call, server);
    const site = await context.newPage();
    await signIn(site, acme.origin, 'alice@acme.test');
    await expect.poll(() => storedAccounts(context, acme.id)).toHaveLength(1);
    const [alice] = await storedAccounts(context, acme.id);

    // Signing out and in again on the site itself, without Swapdeck.
    await signOutByHand(site);
    await signIn(site, acme.origin, 'carol@acme.test');
    await expect.poll(() => storedAccounts(context, acme.id)).toHaveLength(2);
    const carol = (await storedAccounts(context, acme.id)).find((account) => account.email === 'carol@acme.test')!;
    expect(await activeAccount(context, acme.id)).toBe(carol.id);

    // Alice's saved session was kept: switching back works.
    const popup = await openPopup(site);
    await popup.getByRole('button', { name: /switch to alice/i }).click();
    await expect(site.locator('#server-user')).toHaveText('alice@acme.test');
    expect(await whoIsSignedIn(site)).toEqual(signedInAs('alice@acme.test'));
    expect(await activeAccount(context, acme.id)).toBe(alice!.id);
  });

  test('restores an account after the site was signed out, without saving the signed-out state', async ({
    context,
    server,
    call,
    openPopup,
  }) => {
    const acme = await addAcme(call, server, { detector: { kind: 'localStorage', keys: ['sb-acme-auth-token'] } });
    const site = await context.newPage();
    await signIn(site, acme.origin, 'alice@acme.test');
    await expect.poll(() => storedAccounts(context, acme.id)).toHaveLength(1);
    await signOutByHand(site);

    const popup = await openPopup(site);
    await expect(popup.getByText(/not signed in to acme/i)).toBeVisible();
    await popup.getByRole('button', { name: /^open alice nguyen/i }).click();
    await expect(site.locator('#server-user')).toHaveText('alice@acme.test');
    expect(await whoIsSignedIn(site)).toEqual(signedInAs('alice@acme.test'));
  });

  test("notices sign-ins in single-page apps that don't reload", async ({ context, server, call }) => {
    const acme = await addAcme(call, server);
    const site = await context.newPage();
    await site.goto(`${acme.origin}/spa/sign-in`);
    await site.locator('#email').fill('alice@acme.test');
    await site.locator('#sign-in').click();
    await expect(site).toHaveURL(/\/spa\/home$/);
    await expect.poll(() => storedAccounts(context, acme.id)).toHaveLength(1);

    // A session written shortly after the page finished loading (like an OAuth redirect).
    expect((await call('fresh', { appId: acme.id })).ok).toBe(true);
    await site.goto(`${acme.origin}/spa-late?late=bob@acme.test`);
    await expect.poll(() => storedAccounts(context, acme.id), { timeout: 10_000 }).toHaveLength(2);
  });

  for (const [stagingPath, what] of [
    ['/bounce', 'redirects away'],
    ['/empty-403', 'shows an error page'],
  ] as const) {
    test(`falls back to another static page when the switching page ${what}`, async ({
      context,
      server,
      call,
      openPopup,
    }) => {
      const acme = await addAcme(call, server, { stagingPath });
      const site = await context.newPage();
      await signIn(site, acme.origin, 'alice@acme.test');
      await expect.poll(() => storedAccounts(context, acme.id)).toHaveLength(1);
      const popup = await openPopup(site);
      await popup.getByRole('button', { name: /sign in with another account/i }).click();
      await expect(site.locator('#server-user')).toHaveText('nobody');
      await signIn(site, acme.origin, 'bob@acme.test');
      await expect.poll(() => storedAccounts(context, acme.id)).toHaveLength(2);
      await popup.getByRole('button', { name: /switch to alice/i }).click();
      await expect(site.locator('#server-user')).toHaveText('alice@acme.test');
      expect(await whoIsSignedIn(site)).toEqual(signedInAs('alice@acme.test'));
    });
  }

  test("keeps the site's own scripts from running on the switching page", async ({
    context,
    server,
    call,
    openPopup,
  }) => {
    const acme = await addAcme(call, server, { stagingPath: '/spa-robots.txt' });
    const site = await context.newPage();
    await signIn(site, acme.origin, 'alice@acme.test');
    await expect.poll(() => storedAccounts(context, acme.id)).toHaveLength(1);
    const popup = await openPopup(site);
    await popup.getByRole('button', { name: /sign in with another account/i }).click();
    await expect(site.locator('#server-user')).toHaveText('nobody');
    await signIn(site, acme.origin, 'bob@acme.test');
    await expect.poll(() => storedAccounts(context, acme.id)).toHaveLength(2);

    await popup.getByRole('button', { name: /switch to alice/i }).click();
    await expect(site.locator('#server-user')).toHaveText('alice@acme.test');
    expect(await site.evaluate(() => localStorage.getItem('shell-ran'))).toBeNull();
  });

  test("saves a session by hand when the site can't be recognised", async ({ context, server, call, openPopup }) => {
    const acme = await addAcme(call, server, { detector: { kind: 'none' } });
    const site = await context.newPage();
    await signIn(site, acme.origin, 'alice@acme.test');
    const popup = await openPopup(site);
    await expect(popup.getByText(/no accounts saved for acme yet/i)).toBeVisible();
    await popup.getByRole('button', { name: /^save this session$/i }).click();
    await expect(popup.getByRole('listitem')).toHaveCount(1);
    await expect.poll(() => activeAccount(context, acme.id)).not.toBeNull();
  });

  test('remembers recent projects and opens each account where it left off', async ({
    context,
    server,
    call,
    openPopup,
  }) => {
    const acme = await addAcme(call, server, { recentPattern: '^/project/([a-z0-9]+)', titleSuffix: ' | Acme' });
    const site = await context.newPage();
    await signIn(site, acme.origin, 'alice@acme.test');
    await site.goto(`${acme.origin}/project/alpha`);
    await expect
      .poll(async () => (await storedAccounts(context, acme.id))[0] as unknown)
      .toMatchObject({
        recents: [{ key: 'alpha', title: 'Project alpha' }],
      });

    const popup = await openPopup(site);
    await popup.getByRole('button', { name: /sign in with another account/i }).click();
    await signIn(site, acme.origin, 'bob@acme.test');
    await expect.poll(() => storedAccounts(context, acme.id)).toHaveLength(2);

    await popup.getByRole('button', { name: /switch to alice/i }).click();
    await expect(site).toHaveURL(`${acme.origin}/project/alpha`);
    await expect(site.locator('#server-user')).toHaveText('alice@acme.test');
    await expect(popup.getByRole('button', { name: 'Project alpha' })).toBeVisible();
  });

  test('needs the passphrase to switch while locked, but keeps saving', async ({
    context,
    server,
    call,
    openPopup,
  }) => {
    const acme = await addAcme(call, server);
    expect((await call('vault.create', { passphrase: 'correct horse battery' })).ok).toBe(true);
    const site = await context.newPage();
    await signIn(site, acme.origin, 'alice@acme.test');
    await expect.poll(() => storedAccounts(context, acme.id)).toHaveLength(1);
    expect((await call('vault.lock')).ok).toBe(true);

    // Saving works while locked.
    const popup = await openPopup(site);
    await popup.getByRole('button', { name: /sign in with another account/i }).click();
    await signIn(site, acme.origin, 'bob@acme.test');
    await expect.poll(() => storedAccounts(context, acme.id)).toHaveLength(2);

    await expect(popup.getByText(/saved sessions are locked/i)).toBeVisible();
    await popup.getByRole('button', { name: /switch to alice/i }).click();
    await popup.getByLabel('Passphrase').fill('wrong passphrase');
    await popup.getByRole('button', { name: 'Unlock' }).click();
    await expect(popup.getByText('Wrong passphrase.')).toBeVisible();
    await popup.getByLabel('Passphrase').fill('correct horse battery');
    await popup.getByRole('button', { name: 'Unlock' }).click();
    await expect(site.locator('#server-user')).toHaveText('alice@acme.test');
  });

  test('switches with the keyboard shortcut handler and the manager', async ({
    context,
    server,
    call,
    openExtensionPage,
  }) => {
    const acme = await addAcme(call, server);
    const site = await context.newPage();
    await signIn(site, acme.origin, 'alice@acme.test');
    await expect.poll(() => storedAccounts(context, acme.id)).toHaveLength(1);
    expect((await call('fresh', { appId: acme.id })).ok).toBe(true);
    await expect(site.locator('#server-user')).toHaveText('nobody');
    await signIn(site, acme.origin, 'bob@acme.test');
    await expect.poll(() => storedAccounts(context, acme.id)).toHaveLength(2);

    // "Next account" cycles from Bob back to Alice.
    await site.bringToFront();
    expect((await call('cycle', { step: 1 })).ok).toBe(true);
    await expect(site.locator('#server-user')).toHaveText('alice@acme.test');

    const manager = await openExtensionPage(`options/options.html#/apps/${acme.id}`);
    await manager.getByRole('listitem').filter({ hasText: 'Bob Tran' }).getByRole('button', { name: 'Switch' }).click();
    await expect(site.locator('#server-user')).toHaveText('bob@acme.test');
    await manager.goto(manager.url().replace(/#.*$/, '#/history'));
    await expect(manager.getByRole('table')).toContainText('Bob Tran');
  });
});
