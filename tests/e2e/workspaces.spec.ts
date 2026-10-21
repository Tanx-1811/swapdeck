import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { activeAccount, addAcme, readExtensionStorage, signIn, storedAccounts } from './helpers';
import type { TestServer } from './test-server';

type Call = <T = unknown>(
  type: string,
  payload?: Record<string, unknown>,
) => Promise<{ ok: boolean; data?: T; error?: string }>;

/** Two apps (two sites) with Alice and Bob saved on each. */
async function twoAppsTwoPeople(context: BrowserContext, server: TestServer, call: Call) {
  const acme = await addAcme(call, server);
  const globex = await addAcme(call, server, { host: 'globex.test', name: 'Globex' });
  const tabs: Record<string, Page> = {};
  for (const app of [acme, globex]) {
    const page = await context.newPage();
    await signIn(page, app.origin, 'alice@acme.test');
    await expect.poll(() => storedAccounts(context, app.id)).toHaveLength(1);
    expect((await call('fresh', { appId: app.id })).ok).toBe(true);
    await expect(page.locator('#server-user')).toHaveText('nobody');
    await signIn(page, app.origin, 'bob@acme.test');
    await expect.poll(() => storedAccounts(context, app.id)).toHaveLength(2);
    tabs[app.id] = page;
  }
  const id = async (appId: string, email: string) =>
    (await storedAccounts(context, appId)).find((account) => account.email === email)!.id;
  return {
    acme,
    globex,
    tabs,
    alice: { [acme.id]: await id(acme.id, 'alice@acme.test'), [globex.id]: await id(globex.id, 'alice@acme.test') },
    bob: { [acme.id]: await id(acme.id, 'bob@acme.test'), [globex.id]: await id(globex.id, 'bob@acme.test') },
  };
}

test.describe('workspaces', () => {
  test('switch every app at once, including apps that are not open', async ({ context, server, call, openPopup }) => {
    const setup = await twoAppsTwoPeople(context, server, call);
    for (const [name, members] of [
      ['Team Alice', setup.alice],
      ['Team Bob', setup.bob],
    ] as const) {
      expect((await call('workspace.save', { workspace: { name, color: '#1f6fde', members, links: [] } })).ok).toBe(
        true,
      );
    }
    // Globex is not open any more: it must switch in the background.
    await setup.tabs[setup.globex.id]!.close();
    const site = setup.tabs[setup.acme.id]!;
    const tabsBefore = context.pages().length;

    const popup = await openPopup(site);
    await expect(popup.getByRole('button', { name: /Team Bob/ })).toHaveAttribute('aria-pressed', 'true');
    await popup.getByRole('button', { name: /Team Alice/ }).click();
    await expect(site.locator('#server-user')).toHaveText('alice@acme.test');
    await expect.poll(() => activeAccount(context, setup.globex.id)).toBe(setup.alice[setup.globex.id]);
    await expect(popup.getByRole('button', { name: /Team Alice/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(popup.getByText(/Switched to "Team Alice": 2 apps/)).toBeVisible();
    expect(context.pages().length).toBe(tabsBefore + 1); // only the popup itself

    const globex = await context.newPage();
    await globex.goto(`${setup.globex.origin}/dashboard`);
    await expect(globex.locator('#server-user')).toHaveText('alice@acme.test');
    await expect(globex.locator('#storage-user')).toHaveText('alice@acme.test');

    const history = await readExtensionStorage<{ via?: string }[]>(context, 'sd:history');
    expect(history.filter((entry) => entry.via === 'Team Alice')).toHaveLength(2);
  });

  test('switches apps with no open tab through one hidden tab, leaving nothing open', async ({
    context,
    server,
    call,
    extensionId,
  }) => {
    const setup = await twoAppsTwoPeople(context, server, call);
    const saved = await call<{ id: string }>('workspace.save', {
      workspace: { name: 'Team Alice', color: '#1f6fde', members: setup.alice, links: [] },
    });
    for (const page of Object.values(setup.tabs)) await page.close();
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html?tab=-1`);
    await popup.locator('html[data-ready]').waitFor({ state: 'attached' });
    const before = context.pages().length;
    await popup.getByRole('button', { name: /Team Alice/ }).click();
    await expect(popup.getByText(/Switched to "Team Alice": 2 apps/)).toBeVisible();
    expect(context.pages().length).toBe(before);
    for (const app of [setup.acme, setup.globex]) {
      expect(await activeAccount(context, app.id)).toBe(setup.alice[app.id]);
      const page = await context.newPage();
      await page.goto(`${app.origin}/dashboard`);
      await expect(page.locator('#server-user')).toHaveText('alice@acme.test');
    }
    expect(saved.ok).toBe(true);
  });

  test('suggests workspaces from email domains and opens a workspace in a tab group', async ({
    context,
    server,
    call,
    openExtensionPage,
    worker,
  }) => {
    const setup = await twoAppsTwoPeople(context, server, call);
    const page = await openExtensionPage('options/options.html#/workspaces');
    // Alice and Bob share acme.test: one suggestion with one account per app.
    await expect(page.getByText('Suggested workspaces')).toBeVisible();
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByText(/Workspace "Acme" created with 2 apps/)).toBeVisible();

    await page.getByRole('link', { name: 'New workspace' }).first().click();
    await page.getByLabel('Name').fill('Client Globex');
    await page.getByLabel('Acme', { exact: true }).selectOption({ label: 'Alice Nguyen — alice@acme.test' });
    await page.getByLabel('Globex', { exact: true }).selectOption({ label: 'Alice Nguyen — alice@acme.test' });
    await page.getByRole('button', { name: 'Add page' }).click();
    await page.getByLabel('Title').fill('Globex projects');
    await page.getByLabel('Address').fill(`${setup.globex.origin}/project/alpha`);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const card = page.getByRole('listitem').filter({ hasText: 'Client Globex' });
    await expect(card).toContainText('1 pages');

    await card.getByRole('button', { name: 'Open workspace' }).click();
    await expect.poll(() => context.pages().some((tab) => tab.url().endsWith('/project/alpha'))).toBe(true);
    const grouped = await worker.evaluate(async () => {
      const [group] = await chrome.tabGroups.query({ title: 'Client Globex' });
      return group ? (await chrome.tabs.query({ groupId: group.id })).map((tab) => tab.url) : [];
    });
    expect(grouped).toEqual([expect.stringContaining('/project/alpha')]);
    const opened = context.pages().find((tab) => tab.url().endsWith('/project/alpha'))!;
    await expect(opened.locator('#server-user')).toHaveText('alice@acme.test');
  });
});

test.describe('wide popup, search and side panel', () => {
  test('lists every app, searches across them and switches other apps in the background', async ({
    context,
    server,
    call,
    openPopup,
    extensionId,
    tabIdOf,
  }) => {
    const setup = await twoAppsTwoPeople(context, server, call);
    await addAcme(call, server, { host: 'third.test', name: 'Third' });
    const site = setup.tabs[setup.acme.id]!;
    const popup = await openPopup(site);
    await popup.setViewportSize({ width: 720, height: 600 });
    await expect(popup.locator('html')).toHaveClass(/layout-wide/);
    await expect(popup.locator('.app-row')).toHaveCount(3);
    await expect(popup.locator('.app-row').first()).toContainText('This tab');

    // Search across apps; pick Globex's Alice without leaving the current page.
    await popup.getByRole('searchbox').fill('globex alice');
    await popup.getByRole('button', { name: /switch to alice nguyen/i }).click();
    await expect(popup.getByText('Globex now uses "Alice Nguyen"')).toBeVisible();
    await expect.poll(() => activeAccount(context, setup.globex.id)).toBe(setup.alice[setup.globex.id]);
    await expect(setup.tabs[setup.globex.id]!.locator('#server-user')).toHaveText('alice@acme.test');
    await expect(site.locator('#server-user')).toHaveText('bob@acme.test');

    // The side panel shows the same switcher for the tab it sits next to.
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel/sidepanel.html?tab=${await tabIdOf(site)}`);
    await panel.locator('html[data-ready]').waitFor({ state: 'attached' });
    await expect(panel.locator('html')).toHaveClass(/mode-panel/);
    await expect(panel.getByRole('heading', { name: 'Acme', level: 1 })).toBeVisible();
    await panel.getByRole('button', { name: /switch to alice nguyen/i }).click();
    await expect(site.locator('#server-user')).toHaveText('alice@acme.test');
  });

  test('adds a site that has no preset from the popup in one click', async ({ context, server, openPopup }) => {
    const site = await context.newPage();
    await site.goto(server.url('shop.test', '/plain'));
    const popup = await openPopup(site);
    await expect(popup.getByText('shop.test is not in Swapdeck yet.')).toBeVisible();
    await popup.getByRole('button', { name: 'Add this site' }).click();
    await expect(popup.getByRole('heading', { name: 'Shop', level: 1 })).toBeVisible();
    const apps = await readExtensionStorage<{ domains: string[] }[]>(context, 'sd:apps');
    expect(apps.map((app) => app.domains)).toEqual([['shop.test']]);
  });
});

test('adds several presets at once from the gallery', async ({ openExtensionPage, context }) => {
  const page = await openExtensionPage('options/options.html#/add');
  await page.getByRole('button', { name: 'Select several' }).click();
  for (const name of ['Vercel', 'Netlify', 'GitHub']) {
    await page.getByRole('searchbox', { name: 'Search apps' }).fill(name);
    await page.getByRole('button', { name: new RegExp(`^${name}`) }).click();
  }
  await expect(page.getByText('3 selected')).toBeVisible();
  await page.getByRole('button', { name: 'Add 3 apps' }).click();
  await expect(page.getByRole('heading', { name: 'Apps & accounts' })).toBeVisible();
  const apps = await readExtensionStorage<{ presetId: string }[]>(context, 'sd:apps');
  expect(apps.map((app) => app.presetId).sort()).toEqual(['github', 'netlify', 'vercel']);
});
