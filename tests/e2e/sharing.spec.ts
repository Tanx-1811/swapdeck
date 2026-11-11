import { expect, test } from './fixtures';
import { activeAccount, addAcme, signIn, signOutByHand, storedAccounts, whoIsSignedIn } from './helpers';

const signedInAs = (email: string) => ({ server: email, cookie: email, storage: email });

test.describe('importing and sending sign-ins', () => {
  test('saves a Playwright storage state as an account, then switches to it', async ({
    context,
    server,
    call,
    tabIdOf,
  }) => {
    const acme = await addAcme(call, server);
    const site = await context.newPage();
    await signIn(site, acme.origin, 'alice@acme.test');
    const exported = await context.storageState();
    await expect.poll(() => storedAccounts(context, acme.id)).toHaveLength(1);
    const [alice] = await storedAccounts(context, acme.id);
    await signOutByHand(site);
    await signIn(site, acme.origin, 'bob@acme.test');
    await expect.poll(() => storedAccounts(context, acme.id)).toHaveLength(2);
    await call('account.remove', { id: alice!.id });

    const imported = await call<{ accountId: string; created: boolean; cookies: number }>('session.import', {
      appId: acme.id,
      text: JSON.stringify(exported),
    });
    expect(imported.ok, imported.error).toBe(true);
    expect(imported.data?.created).toBe(true);
    const accounts = await storedAccounts(context, acme.id);
    expect(accounts.find((account) => account.id === imported.data?.accountId)?.email).toBe('alice@acme.test');
    // Nothing in the browser changed.
    expect(await whoIsSignedIn(site)).toEqual(signedInAs('bob@acme.test'));

    const switched = await call('switch', {
      appId: acme.id,
      accountId: imported.data!.accountId,
      tabId: await tabIdOf(site),
    });
    expect(switched.ok, switched.error).toBe(true);
    await expect(site.locator('#server-user')).toHaveText('alice@acme.test');
    expect(await whoIsSignedIn(site)).toEqual(signedInAs('alice@acme.test'));

    // Importing it again updates the same account instead of adding another.
    const again = await call<{ accountId: string; created: boolean }>('session.import', {
      appId: acme.id,
      text: JSON.stringify(exported),
    });
    expect(again.data).toMatchObject({ accountId: imported.data!.accountId, created: false });
    const bad = await call('session.import', { appId: acme.id, text: 'not an export' });
    expect(bad).toMatchObject({ ok: false, error: 'INVALID' });
  });

  test('sends one account in a password-locked file that can only be added', async ({ context, server, call }) => {
    const acme = await addAcme(call, server);
    const site = await context.newPage();
    await signIn(site, acme.origin, 'alice@acme.test');
    await signOutByHand(site);
    await signIn(site, acme.origin, 'bob@acme.test');
    await expect.poll(() => storedAccounts(context, acme.id)).toHaveLength(2);
    const alice = (await storedAccounts(context, acme.id)).find((account) => account.email === 'alice@acme.test')!;

    const refused = await call('backup.export', {
      password: null,
      includeSessions: true,
      only: { accountId: alice.id },
    });
    expect(refused).toMatchObject({ ok: false, error: 'INVALID' });

    const shared = await call<{ text: string }>('backup.export', {
      password: 'correct horse',
      includeSessions: true,
      only: { accountId: alice.id },
    });
    expect(shared.ok).toBe(true);
    const file = JSON.parse(shared.data!.text) as { shared?: boolean; encrypted: boolean };
    expect(file).toMatchObject({ shared: true, encrypted: true });

    const summary = await call<{ accounts: number; sessions: number; shared: boolean }>('backup.inspect', {
      text: shared.data!.text,
      password: 'correct horse',
    });
    expect(summary.data).toMatchObject({ accounts: 1, sessions: 1, shared: true });

    const replace = await call('backup.import', {
      text: shared.data!.text,
      password: 'correct horse',
      mode: 'replace',
    });
    expect(replace).toMatchObject({ ok: false, error: 'INVALID', detail: 'shared' });
    // The mark is inside the locked part too: taking it off the file changes nothing.
    const unmarked = JSON.stringify({ ...JSON.parse(shared.data!.text), shared: undefined });
    expect(await call('backup.import', { text: unmarked, password: 'correct horse', mode: 'replace' })).toMatchObject({
      ok: false,
      error: 'INVALID',
      detail: 'shared',
    });
    expect(await storedAccounts(context, acme.id)).toHaveLength(2);

    // Someone else's Swapdeck: here, the same one with Alice removed.
    await call('account.remove', { id: alice.id });
    const merged = await call<{ accounts: number; sessions: number }>('backup.import', {
      text: shared.data!.text,
      password: 'correct horse',
      mode: 'merge',
    });
    expect(merged.data).toMatchObject({ accounts: 1, sessions: 1 });
    expect((await storedAccounts(context, acme.id)).map((account) => account.email).sort()).toEqual([
      'alice@acme.test',
      'bob@acme.test',
    ]);
    // A shared file isn't a backup of this computer.
    expect(await activeAccount(context, acme.id)).not.toBe(null);
  });
});
