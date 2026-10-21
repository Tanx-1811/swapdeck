import type { BrowserContext, Page } from '@playwright/test';
import type { TestServer } from './test-server';

export type AppOptions = {
  host?: string;
  name?: string;
  stagingPath?: string;
  detector?: Record<string, unknown>;
  recentPattern?: string;
  titleSuffix?: string;
};

type Call = <T = unknown>(
  type: string,
  payload?: Record<string, unknown>,
) => Promise<{ ok: boolean; data?: T; error?: string }>;

/** Adds the fake "Acme" app (served by the test server) and returns its id and origin. */
export async function addAcme(call: Call, server: TestServer, options: AppOptions = {}) {
  const host = options.host ?? 'acme.test';
  const origin = server.url(host, '').replace(/\/$/, '');
  const result = await call<{ id: string }>('app.add', {
    app: {
      name: options.name ?? 'Acme',
      color: '#e8590c',
      domains: [host],
      origin,
      homeUrl: `${origin}/dashboard`,
      stagingPath: options.stagingPath ?? '/robots.txt',
      storage: { cookies: true, localStorage: true, sessionStorage: false, indexedDB: false },
      detector: options.detector ?? { kind: 'auto' },
      ...(options.recentPattern ? { recentPattern: options.recentPattern } : {}),
      ...(options.titleSuffix ? { titleSuffix: options.titleSuffix } : {}),
    },
  });
  if (!result.ok || !result.data) throw new Error(`app.add failed: ${result.error}`);
  return { id: result.data.id, origin };
}

/** Opens the fake app and signs in with the given email (as a person would). */
export async function signIn(page: Page, origin: string, email: string) {
  if (!page.url().startsWith(origin)) await page.goto(`${origin}/dashboard`);
  await page.locator('#email').fill(email);
  await page.locator('#sign-in').click();
  await page.locator('#server-user', { hasText: email }).waitFor();
}

export async function signOutByHand(page: Page) {
  await page.locator('#sign-out').click();
  await page.locator('#server-user', { hasText: 'nobody' }).waitFor();
}

/** Who each part of the fake app's sign-in says is signed in. */
export async function whoIsSignedIn(page: Page) {
  return {
    server: await page.locator('#server-user').textContent(),
    cookie: await page.locator('#page-user').textContent(),
    storage: await page.locator('#storage-user').textContent(),
  };
}

export async function readExtensionStorage<T = unknown>(context: BrowserContext, key: string): Promise<T> {
  const [worker] = context.serviceWorkers();
  return worker!.evaluate(async (name) => (await chrome.storage.local.get(name))[name], key) as Promise<T>;
}

/** Accounts of an app as stored, in order. */
export async function storedAccounts(context: BrowserContext, appId: string) {
  const accounts =
    (await readExtensionStorage<{ id: string; appId: string; label: string; email?: string }[]>(
      context,
      'sd:accounts',
    )) ?? [];
  return accounts.filter((account) => account.appId === appId);
}

export async function activeAccount(context: BrowserContext, appId: string) {
  const active = (await readExtensionStorage<Record<string, string | null>>(context, 'sd:active')) ?? {};
  return active[appId] ?? null;
}
