import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { seedDemo } from './demo-data';
import { expect, test } from './fixtures';

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
    await seedDemo(seeder, { theme, language: theme === 'dark' ? 'vi' : 'en', vaultNudge: true });

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
