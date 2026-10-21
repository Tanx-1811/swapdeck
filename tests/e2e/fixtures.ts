import { resolve } from 'node:path';
import { test as base, chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { startTestServer, type TestServer } from './test-server';

export type ExtensionOptions = {
  /** Build folder of the extension to load, relative to the project root. */
  extensionDir: string;
};

type Fixtures = {
  context: BrowserContext;
  worker: Worker;
  extensionId: string;
  /** Opens an extension page (e.g. "options/options.html#/apps") and waits until it has rendered. */
  openExtensionPage: (path: string) => Promise<Page>;
  /** Opens the popup as a tab that acts on the given page's tab. */
  openPopup: (forPage?: Page) => Promise<Page>;
  /** The Chrome tab id of a page. */
  tabIdOf: (page: Page) => Promise<number>;
  /** Sends a request to the service worker, as the extension's pages do. */
  call: <T = unknown>(
    type: string,
    payload?: Record<string, unknown>,
  ) => Promise<{ ok: boolean; data?: T; error?: string }>;
};

type WorkerFixtures = ExtensionOptions & { server: TestServer };

export const test = base.extend<Fixtures, WorkerFixtures>({
  extensionDir: ['dist-e2e', { option: true, scope: 'worker' }],

  server: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, provide) => {
      const server = await startTestServer();
      await provide(server);
      await server.close();
    },
    { scope: 'worker' },
  ],

  context: async ({ extensionDir }, provide) => {
    const path = resolve(import.meta.dirname, '../..', extensionDir);
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: !process.env.HEADED,
      viewport: { width: 1280, height: 800 },
      acceptDownloads: true,
      args: [
        `--disable-extensions-except=${path}`,
        `--load-extension=${path}`,
        // Every *.test host is the local test server.
        '--host-resolver-rules=MAP *.test 127.0.0.1',
        '--disable-features=HttpsUpgrades,HttpsFirstBalancedModeAutoEnable',
      ],
    });
    await provide(context);
    await context.close();
  },

  worker: async ({ context }, provide) => {
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent('serviceworker');
    await provide(worker);
  },

  extensionId: async ({ worker }, provide) => {
    await provide(new URL(worker.url()).host);
  },

  openExtensionPage: async ({ context, extensionId }, provide) => {
    await provide(async (path) => {
      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/${path}`);
      await page.locator('html[data-ready]').waitFor({ state: 'attached' });
      return page;
    });
  },

  tabIdOf: async ({ worker }, provide) => {
    await provide(async (page) => {
      const marker = `swapdeck-tab-${Math.random().toString(36).slice(2)}`;
      const original = await page.title();
      await page.evaluate((title) => (document.title = title), marker);
      const id = await worker.evaluate(async (title) => {
        const [tab] = await chrome.tabs.query({ title });
        return tab?.id ?? -1;
      }, marker);
      await page.evaluate((title) => (document.title = title), original);
      if (id === -1) throw new Error('Tab not found');
      return id;
    });
  },

  openPopup: async ({ context, extensionId, tabIdOf }, provide) => {
    await provide(async (forPage) => {
      const tabId = forPage ? await tabIdOf(forPage) : -1;
      const popup = await context.newPage();
      await popup.setViewportSize({ width: 380, height: 600 });
      await popup.goto(`chrome-extension://${extensionId}/popup/popup.html?tab=${tabId}`);
      await popup.locator('html[data-ready]').waitFor({ state: 'attached' });
      return popup;
    });
  },

  call: async ({ context, extensionId }, provide) => {
    let page: Page | null = null;
    await provide(async (type, payload = {}) => {
      if (!page || page.isClosed()) {
        page = await context.newPage();
        await page.goto(`chrome-extension://${extensionId}/popup/popup.html?tab=-1`);
      }
      return page.evaluate(([kind, body]) => chrome.runtime.sendMessage({ type: kind, ...body }), [
        type,
        payload,
      ] as const);
    });
  },
});

export const expect = test.expect;
