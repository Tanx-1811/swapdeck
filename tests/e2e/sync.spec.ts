import type { BrowserContext } from '@playwright/test';
import { seedDemo } from './demo-data';
import { expect, test } from './fixtures';
import { addAcme, readExtensionStorage, signIn, storedAccounts } from './helpers';

type StoredAccount = { id: string; label: string; email?: string; capturedAt?: number };

/** Swapdeck's items in chrome.storage.sync. */
async function syncItems(context: BrowserContext): Promise<Record<string, unknown>> {
  const [worker] = context.serviceWorkers();
  const all = await worker!.evaluate(() => chrome.storage.sync.get(null));
  return Object.fromEntries(Object.entries(all).filter(([key]) => key.startsWith('sd1:')));
}

test.describe('sync of the list', () => {
  test('travels through Chrome Sync without sign-ins, and takes what other computers change', async ({
    context,
    server,
    call,
    openExtensionPage,
  }) => {
    const acme = await addAcme(call, server);
    const site = await context.newPage();
    await signIn(site, acme.origin, 'alice@acme.test');
    await expect.poll(() => storedAccounts(context, acme.id)).toHaveLength(1);
    const [alice] = await storedAccounts(context, acme.id);

    const settings = await openExtensionPage('options/options.html#/settings');
    const card = settings.locator('section', { has: settings.locator('#sync') });
    await card.getByRole('switch', { name: 'Sync the list through Chrome Sync' }).click();
    await expect(card.getByRole('status')).toContainText(/Synced .* · 2 items/);

    const items = await syncItems(context);
    expect(Object.keys(items).sort()).toEqual([`sd1:a:${acme.id}`, `sd1:c:${alice!.id}`].sort());
    const text = JSON.stringify(items);
    for (const secret of ['access_token', 'acme_sid', 'capturedAt', 'sb-acme-auth-token']) {
      expect(text).not.toContain(secret);
    }

    // Another computer renames Alice and adds an account it knows.
    await settings.evaluate(
      async ({ appId, aliceId }) => {
        const key = `sd1:c:${aliceId}`;
        const current = (await chrome.storage.sync.get(key))[key] as { v: Record<string, unknown> };
        await chrome.storage.sync.set({
          [key]: { v: { ...current.v, label: 'Alice (laptop)' }, t: Date.now(), by: 'laptop' },
          'sd1:c:acc_laptop': {
            v: {
              id: 'acc_laptop',
              appId,
              label: 'Carol',
              color: '#2f6f5e',
              email: 'carol@acme.test',
              pins: [],
              order: 5,
              createdAt: Date.now(),
            },
            t: Date.now(),
            by: 'laptop',
          },
        });
      },
      { appId: acme.id, aliceId: alice!.id },
    );
    await expect
      .poll(async () => (await storedAccounts(context, acme.id)).map((account) => account.label).sort())
      .toEqual(['Alice (laptop)', 'Carol']);
    const stored = await readExtensionStorage<StoredAccount[]>(context, 'sd:accounts');
    // Alice keeps the sign-in saved here; Carol has none yet.
    expect(stored.find((account) => account.id === alice!.id)?.capturedAt).toBeGreaterThan(0);
    expect(stored.find((account) => account.id === 'acc_laptop')?.capturedAt).toBeUndefined();

    // Removed on the other computer: removed here.
    await settings.evaluate(() =>
      chrome.storage.sync.set({ 'sd1:c:acc_laptop': { gone: true, t: Date.now(), by: 'laptop' } }),
    );
    await expect
      .poll(async () => (await storedAccounts(context, acme.id)).map((account) => account.label))
      .toEqual(['Alice (laptop)']);

    // Removing the list from Chrome Sync turns sync off here and removes nothing.
    await card.getByRole('button', { name: 'Remove from Chrome Sync' }).click();
    await settings.getByRole('dialog').getByRole('button', { name: 'Remove from Chrome Sync' }).click();
    await expect.poll(async () => Object.keys(await syncItems(context))).toEqual([]);
    await expect(card.getByRole('switch', { name: 'Sync the list through Chrome Sync' })).not.toBeChecked();
    await expect(card.getByRole('button', { name: 'Remove from Chrome Sync' })).toHaveCount(0);
    expect(await storedAccounts(context, acme.id)).toHaveLength(1);
  });

  test('lists accounts without a sign-in here, and files the next sign-in under them', async ({
    context,
    server,
    call,
    openExtensionPage,
  }) => {
    const acme = await addAcme(call, server);
    const overview = await openExtensionPage('options/options.html#/');
    // As if imported from another computer: the account, without its sign-in.
    await overview.evaluate(async (appId) => {
      const { 'sd:accounts': accounts = [] } = await chrome.storage.local.get('sd:accounts');
      await chrome.storage.local.set({
        'sd:accounts': [
          ...(accounts as unknown[]),
          {
            id: 'acc_carol',
            appId,
            label: 'Carol',
            color: '#2f6f5e',
            email: 'carol@acme.test',
            pins: [],
            recents: [],
            order: 0,
            createdAt: Date.now(),
            switchCount: 0,
          },
        ],
      });
    }, acme.id);
    const card = overview.locator('section', { has: overview.locator('#relogin') });
    await expect(card).toContainText('Carol');

    const opened = context.waitForEvent('page');
    await card.getByRole('button', { name: /Sign in\s+Carol/ }).click();
    const tab = await opened;
    await tab.waitForURL(`${acme.origin}/dashboard`);
    await signIn(tab, acme.origin, 'carol@acme.test');
    await expect
      .poll(async () => (await readExtensionStorage<StoredAccount[]>(context, 'sd:accounts'))[0]?.capturedAt)
      .toBeGreaterThan(0);
    expect(await storedAccounts(context, acme.id)).toHaveLength(1);
    await expect(card).toHaveCount(0);
  });

  test('reminds to back up, backs up in one click, and waits after "Later"', async ({
    context,
    extensionId,
    openExtensionPage,
  }) => {
    const seeder = await openExtensionPage('options/options.html');
    await seedDemo(seeder, { backupNudge: true });
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html?tab=-1`);
    await popup.locator('html[data-ready]').waitFor({ state: 'attached' });
    const nudge = popup.getByText('Back up your saved accounts');
    await expect(nudge).toBeVisible();

    const download = popup.waitForEvent('download');
    await popup.getByRole('button', { name: 'Back up now' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^swapdeck-backup-.+\.json$/);
    const backup = JSON.parse(await (await import('node:fs/promises')).readFile((await file.path())!, 'utf8')) as {
      format: string;
    };
    expect(backup.format).toBe('swapdeck-backup');
    await expect(nudge).toHaveCount(0);
    const settings = await readExtensionStorage<{ lastBackupAt: number }>(context, 'sd:settings');
    expect(settings.lastBackupAt).toBeGreaterThan(0);

    await seedDemo(seeder, { backupNudge: true });
    await popup.reload();
    await expect(nudge).toBeVisible();
    await popup.getByRole('button', { name: 'Later' }).click();
    await expect(nudge).toHaveCount(0);
    await popup.reload();
    await popup.locator('html[data-ready]').waitFor({ state: 'attached' });
    await expect(nudge).toHaveCount(0);
  });
});
