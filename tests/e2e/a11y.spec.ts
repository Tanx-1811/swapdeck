import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { seedDemo } from './demo-data';
import { expect, test } from './fixtures';
import { addAcme, signIn, signOutByHand, storedAccounts } from './helpers';

async function audit(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const problems = results.violations.map((violation) => ({
    rule: violation.id,
    impact: violation.impact,
    targets: violation.nodes.slice(0, 3).map((node) => node.target.join(' ')),
  }));
  expect(problems, label).toEqual([]);
}

for (const theme of ['light', 'dark'] as const) {
  test(`popup and manager have no accessibility violations (${theme})`, async ({
    context,
    extensionId,
    openExtensionPage,
  }) => {
    const seeder = await openExtensionPage('options/options.html');
    await seedDemo(seeder, { theme, language: theme === 'dark' ? 'vi' : 'en', vaultNudge: true, onboarding: true });

    const popup = await context.newPage();
    await popup.setViewportSize({ width: 380, height: 600 });
    for (const query of ['?tab=-1', '?tab=-1&app=app_supabase']) {
      // Wide (two columns) and compact layouts.
      await popup.setViewportSize({ width: 720, height: 600 });
      await popup.goto(`chrome-extension://${extensionId}/popup/popup.html${query}`);
      await popup.locator('html[data-ready]').waitFor({ state: 'attached' });
      await audit(popup, `popup ${query}`);
      await popup.getByRole('searchbox').fill('a');
      await audit(popup, `popup search ${query}`);
    }

    // The confirmation window for a switch started by a shortcut, the address bar or a menu.
    await seeder.evaluate(async () => {
      await chrome.storage.session.set({
        'sd:ask': {
          id: 'a11y',
          at: Date.now(),
          plan: { kind: 'account', appId: 'app_supabase', accountId: 'acc_client' },
          text: {
            title: 'Switch to an important account?',
            body: 'Check twice before you change anything. Switching reloads these tabs:',
            items: ['SQL editor — text being typed'],
            confirm: 'Switch anyway',
            danger: true,
          },
        },
      });
    });
    const ask = await context.newPage();
    await ask.setViewportSize({ width: 460, height: 340 });
    await ask.goto(`chrome-extension://${extensionId}/popup/popup.html?ask=a11y`);
    await ask.locator('html[data-ready]').waitFor({ state: 'attached' });
    await audit(ask, 'confirmation window');
    await ask.close();

    const panel = await context.newPage();
    await panel.setViewportSize({ width: 380, height: 760 });
    await panel.goto(`chrome-extension://${extensionId}/sidepanel/sidepanel.html?tab=-1&app=app_supabase`);
    await panel.locator('html[data-ready]').waitFor({ state: 'attached' });
    await audit(panel, 'side panel');

    for (const hash of [
      '#/',
      '#/workspaces',
      '#/workspaces/ws_company',
      '#/workspaces/new',
      '#/apps',
      '#/apps/app_supabase',
      '#/apps/app_supabase/settings',
      '#/add',
      '#/add/custom?url=https://x.io',
      '#/history',
      '#/backup',
      '#/security',
      '#/settings',
      '#/help',
    ]) {
      await seeder.goto(`chrome-extension://${extensionId}/options/options.html${hash}`);
      await seeder.locator('html[data-ready]').waitFor({ state: 'attached' });
      await audit(seeder, `manager ${hash}`);
    }

    // The backup reminder, and Settings with sync of the list on.
    await seedDemo(seeder, { theme, language: theme === 'dark' ? 'vi' : 'en', backupNudge: true, syncList: true });
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html?tab=-1`);
    await popup.locator('html[data-ready]').waitFor({ state: 'attached' });
    await expect(popup.locator('.callout').first()).toBeVisible();
    await audit(popup, 'popup backup reminder');
    for (const hash of ['#/', '#/settings']) {
      await seeder.goto(`chrome-extension://${extensionId}/options/options.html${hash}`);
      await seeder.locator('html[data-ready]').waitFor({ state: 'attached' });
      if (hash === '#/settings') {
        const sync = seeder.locator('section', { has: seeder.locator('#sync') });
        await expect(sync.getByRole('status')).toContainText('·');
      }
      await audit(seeder, `manager ${hash} with reminders and sync`);
    }
  });
}

// The other accent colors keep the seal, links, switches and focus ring readable.
for (const accent of ['ngoc', 'cham', 'vang'] as const) {
  test(`accent "${accent}" keeps contrast in both themes`, async ({ context, extensionId, openExtensionPage }) => {
    const seeder = await openExtensionPage('options/options.html');
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 720, height: 600 });
    for (const theme of ['light', 'dark'] as const) {
      await seedDemo(seeder, { theme, accent, language: 'vi' });
      await popup.goto(`chrome-extension://${extensionId}/popup/popup.html?tab=-1&app=app_supabase`);
      await popup.locator('html[data-ready]').waitFor({ state: 'attached' });
      await audit(popup, `popup ${accent} ${theme}`);
      for (const hash of ['#/', '#/workspaces', '#/settings']) {
        await seeder.goto(`chrome-extension://${extensionId}/options/options.html${hash}`);
        await seeder.locator('html[data-ready]').waitFor({ state: 'attached' });
        await audit(seeder, `manager ${hash} ${accent} ${theme}`);
      }
    }
  });
}

// Separate tabs, importing a sign-in and sending an account: the popup in a separate tab (compact,
// wide, side panel), the flag on the account, and the manager's dialogs with their errors.
for (const theme of ['light', 'dark'] as const) {
  test(`separate tabs, import and send have no accessibility violations (${theme})`, async ({
    context,
    server,
    call,
    extensionId,
    openExtensionPage,
    tabIdOf,
  }) => {
    test.setTimeout(90_000);
    const acme = await addAcme(call, server);
    await call('settings.update', { patch: { theme, language: theme === 'dark' ? 'vi' : 'en' } });
    const site = await context.newPage();
    await signIn(site, acme.origin, 'alice@acme.test');
    await expect.poll(() => storedAccounts(context, acme.id)).toHaveLength(1);
    await signOutByHand(site);
    await signIn(site, acme.origin, 'bob@acme.test');
    await expect.poll(() => storedAccounts(context, acme.id)).toHaveLength(2);
    const alice = (await storedAccounts(context, acme.id)).find((account) => account.email === 'alice@acme.test')!;

    const opened = context.waitForEvent('page');
    expect((await call('lane.open', { appId: acme.id, accountId: alice.id })).ok).toBe(true);
    const lane = await opened;
    await lane.locator('#server-user', { hasText: 'alice@acme.test' }).waitFor();
    const scratchOpened = context.waitForEvent('page');
    expect((await call('lane.open', { appId: acme.id, accountId: null })).ok).toBe(true);
    const scratch = await scratchOpened;
    await scratch.locator('#server-user', { hasText: 'nobody' }).waitFor();

    const popup = await context.newPage();
    const show = async (path: string, width: number, height: number, label: string) => {
      await popup.setViewportSize({ width, height });
      await popup.goto(`chrome-extension://${extensionId}/${path}`);
      await popup.locator('html[data-ready]').waitFor({ state: 'attached' });
      await audit(popup, label);
    };
    const laneTab = await tabIdOf(lane);
    await show(`popup/popup.html?tab=${await tabIdOf(site)}`, 380, 600, 'popup with a separate tab');
    await show(`popup/popup.html?tab=${laneTab}`, 380, 600, 'popup in a separate tab');
    await expect(popup.locator('.callout').first()).toBeVisible();
    await show(`popup/popup.html?tab=${await tabIdOf(scratch)}`, 380, 600, 'popup in a scratch tab');
    await show(`sidepanel/sidepanel.html?tab=${laneTab}`, 380, 760, 'side panel in a separate tab');
    await call('settings.update', { patch: { popupLayout: 'wide' } });
    await show(`popup/popup.html?tab=${laneTab}`, 720, 600, 'wide popup in a separate tab');

    const manager = await openExtensionPage(`options/options.html#/apps/${acme.id}`);
    await audit(manager, 'app with a separate tab');
    await manager.locator('.app-header button[aria-haspopup]').click();
    await manager.getByRole('menuitem').first().click();
    const dialog = manager.locator('dialog[open]');
    await dialog.locator('textarea').fill('not an export');
    await dialog.locator('button[type=submit]').click();
    await expect(dialog.locator('.callout--danger')).toBeVisible();
    await audit(manager, 'import a sign-in, unknown format');
    await manager.keyboard.press('Escape');

    await manager.locator(`[data-account="${alice.id}"] button[aria-haspopup]`).click();
    await manager
      .getByRole('menuitem')
      .filter({ hasText: theme === 'dark' ? 'Gửi cho người khác' : 'Send to someone' })
      .click();
    await dialog.locator('input[type=password]').first().fill('short');
    await dialog.locator('input[type=password]').nth(1).fill('shorter');
    await expect(dialog.locator('.field__error')).toHaveCount(2);
    await audit(manager, 'send to someone, with errors');
  });
}
