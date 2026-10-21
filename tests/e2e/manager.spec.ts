import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';
import { addAcme, readExtensionStorage, signIn, signOutByHand, storedAccounts } from './helpers';

test.describe('manager', () => {
  test('welcomes new users and adds Supabase from the gallery', async ({ openExtensionPage, context }) => {
    const page = await openExtensionPage('options/options.html?welcome=1');
    await expect(page.getByRole('heading', { name: 'Get started in three steps' })).toBeVisible();
    await page.getByRole('link', { name: 'Add an app' }).click();
    await page.getByRole('searchbox', { name: 'Search apps' }).fill('supa');
    await page.getByRole('button', { name: /^Supabase/ }).click();
    await expect(page.getByRole('heading', { name: 'Supabase', level: 1 })).toBeVisible();
    await expect(page.getByText('Save your first Supabase account')).toBeVisible();
    const apps = await context
      .serviceWorkers()[0]!
      .evaluate(async () => (await chrome.storage.local.get('sd:apps'))['sd:apps']);
    expect(apps).toMatchObject([{ presetId: 'supabase', domains: ['supabase.com'] }]);

    // Category filter and already-added state.
    await page.goto(page.url().replace(/#.*$/, '#/add'));
    await page.getByRole('button', { name: 'AI', exact: true }).click();
    await expect(page.getByRole('button', { name: /^ChatGPT/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Vercel/ })).toHaveCount(0);
  });

  test('adds any website from its address and edits its settings', async ({ openExtensionPage, server }) => {
    const page = await openExtensionPage('options/options.html#/add/custom');
    await page.getByLabel('Website address').fill(server.url('shop.test', '/account'));
    await page.getByRole('button', { name: 'Add', exact: true }).first().click();
    await expect(page.getByLabel('Name')).toHaveValue('Shop');
    await expect(page.locator('.tag')).toHaveText(['shop.test']);
    await page.getByRole('button', { name: 'Add', exact: true }).last().click();
    await expect(page.getByRole('heading', { name: 'Shop', level: 1 })).toBeVisible();

    await page.getByRole('tab', { name: 'Settings' }).click();
    await page.getByLabel('Name').fill('Shop Admin');
    await page.getByRole('button', { name: 'Advanced' }).click();
    await page.getByLabel('Recent items pattern').fill('^/orders/(\\d+)');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('heading', { name: 'Shop Admin', level: 1 })).toBeVisible();

    // A domain that another app already uses is refused.
    await page.goto(page.url().replace(/#.*$/, '#/add/custom'));
    await page.getByLabel('Website address').fill(server.url('www.shop.test', '/'));
    await page.getByRole('button', { name: 'Add', exact: true }).first().click();
    await page.getByRole('button', { name: 'Add', exact: true }).last().click();
    await expect(page.getByText('Another app ("Shop Admin") already uses this domain.')).toBeVisible();
  });

  test('edits, reorders and deletes accounts, and removes the app', async ({
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
    await signIn(site, acme.origin, 'bob@acme.test');
    await expect.poll(() => storedAccounts(context, acme.id)).toHaveLength(2);

    const page = await openExtensionPage(`options/options.html#/apps/${acme.id}`);
    const alice = page.getByRole('listitem').filter({ hasText: 'Alice Nguyen' });
    await alice.getByRole('button', { name: 'Edit' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit account' });
    await dialog.getByLabel('Name').fill('Alice — Work');
    await dialog.getByRole('radio', { name: 'Briefcase' }).click();
    await dialog.getByLabel('Note').fill('Billing owner');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('listitem').filter({ hasText: 'Alice — Work' })).toContainText('Billing owner');

    await page
      .getByRole('listitem')
      .filter({ hasText: 'Bob Tran' })
      .getByRole('button', { name: /more actions/i })
      .click();
    await page.getByRole('menuitem', { name: 'Move up' }).click();
    await expect(page.locator('.account-card strong').first()).toHaveText('Bob Tran');

    await page
      .getByRole('listitem')
      .filter({ hasText: 'Bob Tran' })
      .getByRole('button', { name: /more actions/i })
      .click();
    await page.getByRole('menuitem', { name: 'Delete account' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('listitem').filter({ hasText: 'Bob Tran' })).toHaveCount(0);

    await page
      .getByRole('button', { name: /more actions/i })
      .first()
      .click();
    await page.getByRole('menuitem', { name: 'Remove app' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByRole('heading', { name: 'Apps & accounts' })).toBeVisible();
    await expect(page.getByText('No apps yet.')).toBeVisible();
  });

  test('exports an encrypted backup and imports it again', async ({ context, server, call, openExtensionPage }) => {
    const acme = await addAcme(call, server);
    const site = await context.newPage();
    await signIn(site, acme.origin, 'alice@acme.test');
    await expect.poll(() => storedAccounts(context, acme.id)).toHaveLength(1);

    const page = await openExtensionPage('options/options.html#/backup');
    await page.getByLabel('File password').fill('backup password');
    await page.getByLabel('Repeat password').fill('backup password');
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download backup' }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/^swapdeck-backup-\d{4}-\d{2}-\d{2}\.json$/);
    const text = await readFile(await download.path(), 'utf8');
    expect(text).toContain('"encrypted": true');
    expect(text).not.toContain('alice@acme.test');

    expect((await call('data.wipe')).ok).toBe(true);
    await page.reload();
    await page.locator('html[data-ready]').waitFor({ state: 'attached' });
    await page
      .locator('input[type=file]')
      .setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(text) });
    await page.getByLabel(/This backup is encrypted/).fill('backup password');
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.getByText(/1 apps · 1 accounts · 1 saved sessions · 0 workspaces/)).toBeVisible();
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.getByText('Imported 1 apps, 1 accounts, 1 sessions and 0 workspaces.')).toBeVisible();

    // The imported session really works (the app got a new id when it was imported).
    await site.goto(`${acme.origin}/dashboard`);
    await signOutByHand(site);
    const [imported] = await readExtensionStorage<{ id: string }[]>(context, 'sd:apps');
    const [account] = await storedAccounts(context, imported!.id);
    expect((await call('switch', { appId: imported!.id, accountId: account!.id })).ok).toBe(true);
    await expect(site.locator('#server-user')).toHaveText('alice@acme.test');
  });

  test('changes language and theme, and locks with a passphrase', async ({ openExtensionPage }) => {
    const page = await openExtensionPage('options/options.html#/settings');
    await page.getByLabel('Language').selectOption('vi');
    await expect(page.getByRole('heading', { name: 'Cài đặt' })).toBeVisible();
    await page.getByRole('button', { name: 'Tối' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('switch', { name: 'Hỏi trước khi chuyển' }).check();
    await expect(page.getByRole('switch', { name: 'Hỏi trước khi chuyển' })).toBeChecked();

    await page.getByRole('link', { name: 'Bảo mật' }).click();
    await page.getByLabel('Mật khẩu', { exact: true }).fill('correct horse battery');
    await page.getByLabel('Nhập lại mật khẩu').fill('correct horse battery');
    await page.getByRole('button', { name: 'Bật khóa bằng mật khẩu' }).click();
    await expect(page.getByText('Đã bật khóa bằng mật khẩu.')).toBeVisible();
    await page.getByRole('button', { name: 'Khóa ngay' }).click();
    await expect(page.locator('.sidebar__vault')).toContainText('Đã khóa');
    await page.getByLabel('Mật khẩu', { exact: true }).fill('correct horse battery');
    await page.getByRole('button', { name: 'Mở khóa' }).click();
    await expect(page.locator('.sidebar__vault')).toContainText('Đã mở khóa');
  });
});
