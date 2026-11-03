import { expect, test } from './fixtures';
import { addAcme } from './helpers';

test.describe('getting started and updates', () => {
  test('the getting-started list ticks itself off, hides, and comes back from Help', async ({
    server,
    call,
    openExtensionPage,
  }) => {
    const page = await openExtensionPage('options/options.html#/');
    const card = page.locator('section', { has: page.locator('#get-started') });
    await expect(card).toContainText('0 of 5 done');
    await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    await addAcme(call, server);
    await expect(card).toContainText('1 of 5 done');
    await expect(card.getByRole('button', { name: 'Open Acme' })).toBeVisible();

    await card.getByRole('button', { name: 'Hide' }).click();
    await expect(card).toHaveCount(0);
    await page.goto(page.url().replace(/#.*$/, '#/help'));
    await page.getByRole('button', { name: 'Show "Get started"' }).click();
    await expect(page).toHaveURL(/#\/$/);
    await expect(page.locator('#get-started')).toBeVisible();
  });

  test('checks GitHub for a newer version only when asked', async ({ context, openExtensionPage }) => {
    let requests = 0;
    let latest = '99.0.0';
    let offline = false;
    await context.route('https://api.github.com/repos/Tanx-1811/swapdeck/releases/latest', (route) => {
      requests++;
      if (offline) return route.abort('internetdisconnected');
      return route.fulfill({
        json: {
          tag_name: `v${latest}`,
          html_url: `https://github.com/Tanx-1811/swapdeck/releases/tag/v${latest}`,
          assets: [{ name: `swapdeck-${latest}.zip` }, { name: 'swapdeck-desktop-9.0.0.zip' }],
        },
      });
    });
    const page = await openExtensionPage('options/options.html#/help');
    const version = await page.evaluate(() => chrome.runtime.getManifest().version);
    const card = page.locator('section', { has: page.locator('#updates') });
    await expect(card).toContainText(version);
    expect(requests).toBe(0);

    await card.getByRole('button', { name: 'Check for updates' }).click();
    await expect(card).toContainText('Swapdeck 99.0.0 is available');
    await expect(card.getByRole('link', { name: 'Download' })).toHaveAttribute(
      'href',
      'https://github.com/Tanx-1811/swapdeck/releases/tag/v99.0.0',
    );

    latest = version;
    await card.getByRole('button', { name: 'Check for updates' }).click();
    await expect(card.getByRole('status')).toHaveText(`You have the latest version (${version}).`);

    offline = true;
    await card.getByRole('button', { name: 'Check for updates' }).click();
    await expect(card.getByRole('status')).toHaveText("Couldn't check right now (no connection?).");
    expect(requests).toBe(3);
  });
});
