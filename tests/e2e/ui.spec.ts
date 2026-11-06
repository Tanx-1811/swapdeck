import type { Page } from '@playwright/test';
import { demoStorage } from './demo-data';
import { expect, test } from './fixtures';

type Data = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function seed(page: Page, data: Data) {
  await page.evaluate(async (items) => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set(items);
  }, data);
}

async function ready(page: Page) {
  await page.locator('html[data-ready]').waitFor({ state: 'attached' });
}

/** Demo data with long, punctuated names, as real client accounts are, and enough accounts for the filter. */
function demoWithLongNames(): Data {
  const data = demoStorage() as Data;
  const accounts = data['sd:accounts'] as Data[];
  accounts[0]!.label = 'Khách hàng Công ty TNHH Thương mại Dịch vụ Nguyễn Hoàng Phương Đông — production';
  accounts[0]!.email = 'nguyen.hoang.phuong.dong.ke.toan.truong@congtythuongmaidichvuphuongdong.example';
  for (let index = 0; index < 8; index++) {
    accounts.push({ ...accounts[1]!, id: `acc_more${index}`, label: `Client — Acme ${index}`, order: 10 + index });
  }
  (data['sd:workspaces'] as Data[])[0]!.name = 'Công ty Cổ phần Đầu tư Xây dựng Hạ tầng Đô thị Phương Nam';
  return data;
}

test.describe('manager on a narrow window', () => {
  for (const width of [360, 760]) {
    test(`never scrolls sideways at ${width} px`, async ({ openExtensionPage }) => {
      const page = await openExtensionPage('options/options.html');
      await seed(page, demoWithLongNames());
      await page.setViewportSize({ width, height: 800 });
      for (const hash of [
        '#/',
        '#/workspaces',
        '#/workspaces/ws_company',
        '#/apps',
        '#/apps/app_supabase',
        '#/apps/app_supabase/settings',
        '#/add',
        '#/add/custom?url=https://app.example.com/dashboard',
        '#/history',
        '#/backup',
        '#/security',
        '#/settings',
        '#/help',
      ]) {
        await page.goto(page.url().replace(/#.*$/, '') + hash);
        await page.reload();
        await ready(page);
        const [scrollWidth, innerWidth] = await page.evaluate(() => [
          document.documentElement.scrollWidth,
          window.innerWidth,
        ]);
        expect(scrollWidth, hash).toBeLessThanOrEqual(innerWidth!);
      }
    });
  }
});

test.describe('menus and dialogs', () => {
  test('a menu closes when the page scrolls, and focus comes back after its dialog', async ({ openExtensionPage }) => {
    const page = await openExtensionPage('options/options.html');
    await seed(page, demoStorage());
    await page.setViewportSize({ width: 1280, height: 500 });
    await page.goto(page.url().replace(/#.*$/, '') + '#/apps/app_supabase');
    await page.reload();
    await ready(page);

    await page.getByRole('button', { name: 'More actions', exact: true }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    await page.mouse.wheel(0, 300);
    await expect(page.getByRole('menu')).toHaveCount(0);

    // Edit from a menu, then Escape: the focus is back on the menu's button, not lost.
    const more = page.getByRole('button', { name: 'More actions: Personal' });
    await more.click();
    await page.getByRole('menuitem', { name: 'Delete account' }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete account' });
    await expect(dialog).toBeVisible();
    // A risky choice: Cancel has the focus.
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(more).toBeFocused();

    // No earlier session saved: nothing to restore, so no "Restore" item.
    await more.click();
    await expect(page.getByRole('menuitem', { name: 'Delete account' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Restore/ })).toHaveCount(0);
  });

  test('"ask before every switch" also asks in the manager', async ({ openExtensionPage }) => {
    const page = await openExtensionPage('options/options.html');
    const data = demoStorage();
    (data['sd:settings'] as Data).confirmSwitch = true;
    await seed(page, data);
    await page.goto(page.url().replace(/#.*$/, '') + '#/apps/app_vercel');
    await page.reload();
    await ready(page);
    await page.locator('.account-card').nth(1).getByRole('button', { name: 'Switch' }).click();
    const dialog = page.getByRole('dialog', { name: 'Switch to Personal' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  });
});

test.describe('workspaces in the popup', () => {
  test('saving a new workspace twice in a row creates it once', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options/options.html`);
    await seed(page, demoStorage());
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 720, height: 600 });
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html?tab=-1`);
    await ready(popup);

    await popup.getByRole('button', { name: 'Workspace actions' }).click();
    await popup.getByRole('menuitem', { name: 'New from the accounts in use' }).click();
    const name = popup.getByRole('textbox', { name: 'Name' });
    await expect(name).toBeFocused();
    await name.fill('Twice');
    // Two Enters in a row, before the first save has come back.
    await popup.keyboard.press('Enter');
    await popup.keyboard.press('Enter');
    await expect(popup.getByRole('dialog')).toBeHidden();
    await expect
      .poll(async () =>
        page.evaluate(async () =>
          ((await chrome.storage.local.get('sd:workspaces'))['sd:workspaces'] as { name: string }[])
            .map((workspace) => workspace.name)
            .filter((name) => name === 'Twice'),
        ),
      )
      .toHaveLength(1);
  });

  test('a long list folds into a searchable picker, opened from the workspace in use', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options/options.html`);
    const data = demoStorage();
    const workspaces = data['sd:workspaces'] as Data[];
    for (let index = 0; index < 5; index++) {
      workspaces.push({ ...workspaces[1]!, id: `ws_more${index}`, name: `Studio ${index}`, order: 3 + index });
    }
    await seed(page, data);
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 720, height: 600 });
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html?tab=-1`);
    await ready(popup);

    // The lid names the workspace in use; the bar keeps a few and offers all 8.
    const pill = popup.getByRole('button', { name: 'Workspace in use: Company. Switch workspace' });
    await expect(pill).toBeVisible();
    await expect(popup.locator('.ws-bar .ws-chip:not(.ws-chip--all)')).toHaveCount(3);
    await expect(popup.getByRole('button', { name: 'All 8' })).toBeVisible();

    await pill.click();
    const picker = popup.getByRole('dialog', { name: 'Switch workspace' });
    const search = picker.getByRole('searchbox', { name: 'Find a workspace' });
    await expect(search).toBeFocused();
    await expect(picker.getByRole('listitem')).toHaveCount(8);
    await search.fill('persn');
    await expect(picker.getByText('No workspace matches "persn".')).toBeVisible();
    await search.fill('personal');
    await expect(picker.getByRole('listitem')).toHaveCount(1);
    await search.press('Enter');
    await expect(picker).toBeHidden();
    // The demo accounts have no saved sign-in: nothing switches, and the message says so, one app per line.
    const toast = popup.locator('.toast').filter({ hasText: 'Could not switch any app to "Personal".' });
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('Supabase: There is no saved session to use');
    await expect(toast).not.toContainText('..');

    await popup.getByRole('button', { name: 'All 8' }).click();
    await expect(picker).toBeVisible();
    await popup.keyboard.press('Escape');
    await expect(picker).toBeHidden();
  });

  test('the wide popup falls back to the compact one when it would not fit', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options/options.html`);
    await seed(page, demoStorage());
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 640, height: 600 });
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html?tab=-1&app=app_supabase`);
    await ready(popup);
    await expect(popup.locator('html')).not.toHaveClass(/layout-wide/);
    await popup.setViewportSize({ width: 720, height: 600 });
    await expect(popup.locator('html')).toHaveClass(/layout-wide/);
  });
});
