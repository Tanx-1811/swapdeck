import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from './fixtures';

const manifest = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../dist/manifest.json'), 'utf8'));

test.describe('store build', () => {
  test('asks for no host access at install and stays out of incognito', () => {
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.optional_host_permissions).toEqual(['*://*/*']);
    expect(manifest.incognito).toBe('not_allowed');
    expect(manifest.permissions).toEqual([
      'storage',
      'unlimitedStorage',
      'cookies',
      'scripting',
      'activeTab',
      'contextMenus',
      'alarms',
      'favicon',
      'declarativeNetRequestWithHostAccess',
      'sidePanel',
      'tabGroups',
    ]);
    expect(manifest.side_panel).toEqual({ default_path: 'sidepanel/sidepanel.html' });
  });

  test('starts, opens the manager on first install and asks before touching a site', async ({
    context,
    extensionId,
    call,
  }) => {
    await expect.poll(() => context.pages().some((page) => page.url().includes('options.html?welcome=1'))).toBe(true);

    const added = await call<{ id: string }>('app.add', {
      app: {
        name: 'Acme',
        color: '#e8590c',
        domains: ['acme.test'],
        origin: 'https://acme.test',
        homeUrl: 'https://acme.test/',
        stagingPath: '/robots.txt',
        storage: { cookies: true, localStorage: true, sessionStorage: false, indexedDB: false },
        detector: { kind: 'auto' },
      },
    });
    expect(added.ok).toBe(true);
    // Without access, switching is refused before anything changes.
    const fresh = await call('fresh', { appId: added.data!.id });
    expect(fresh).toMatchObject({ ok: false, error: 'NO_ACCESS' });

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html?tab=-1&app=${added.data!.id}`);
    await popup.locator('html[data-ready]').waitFor({ state: 'attached' });
    await expect(popup.getByText(/needs access to acme\.test/i)).toBeVisible();
    await expect(popup.getByRole('button', { name: 'Allow access' })).toBeVisible();
  });
});
