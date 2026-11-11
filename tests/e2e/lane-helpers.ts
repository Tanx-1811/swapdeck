import type { BrowserContext, Page, Worker } from '@playwright/test';
import { expect } from './fixtures';
import { activeAccount, signIn, signOutByHand, storedAccounts, whoIsSignedIn } from './helpers';

export const signedInAs = (email: string) => ({ server: email, cookie: email, storage: email });

export type Call = <T = unknown>(
  type: string,
  payload?: Record<string, unknown>,
) => Promise<{ ok: boolean; data?: T; error?: string; detail?: string }>;

/** Alice and Bob saved; Bob is the account the browser's own tabs use. Returns the site tab. */
export async function aliceAndBob(context: BrowserContext, acme: { id: string; origin: string }) {
  const site = await context.newPage();
  await signIn(site, acme.origin, 'alice@acme.test');
  await expect.poll(() => storedAccounts(context, acme.id)).toHaveLength(1);
  await signOutByHand(site);
  await signIn(site, acme.origin, 'bob@acme.test');
  await expect.poll(() => storedAccounts(context, acme.id)).toHaveLength(2);
  const accounts = await storedAccounts(context, acme.id);
  const alice = accounts.find((account) => account.email === 'alice@acme.test')!;
  const bob = accounts.find((account) => account.email === 'bob@acme.test')!;
  await expect.poll(() => activeAccount(context, acme.id)).toBe(bob.id);
  return { site, alice, bob };
}

/** Opens a lane through the worker and returns its page once the app has loaded there. */
export async function openLane(context: BrowserContext, call: Call, payload: Record<string, unknown>) {
  const opened = context.waitForEvent('page');
  const result = await call<{ token: string; tabId: number }>('lane.open', payload);
  expect(result.ok, `${result.error} ${result.detail ?? ''}`).toBe(true);
  const page = await opened;
  await page.locator('#server-user').waitFor();
  return { page, token: result.data!.token, tabId: result.data!.tabId };
}

export async function browserCookies(worker: Worker, domain = 'acme.test') {
  return worker.evaluate(
    async (name) =>
      (await chrome.cookies.getAll({ domain: name })).map((cookie) => `${cookie.name}=${cookie.value}`).sort(),
    domain,
  );
}

export async function lanes(worker: Worker) {
  return worker.evaluate(async () => {
    const raw = (await chrome.storage.session.get('sd:lanes'))['sd:lanes'] as
      | { lanes: Record<string, { token: string; kind: string; accountId: string | null; tabIds: number[] }> }
      | undefined;
    return Object.values(raw?.lanes ?? {});
  });
}

export async function reloadAndRead(page: Page) {
  await page.reload();
  await page.locator('#server-user').waitFor();
  return whoIsSignedIn(page);
}

/** What the test server's echo page says the request carried. */
export async function echoOf(page: Page) {
  await page.locator('#echo').waitFor();
  return JSON.parse((await page.locator('#echo').textContent()) ?? '{}') as {
    method: string;
    cookie: string;
    body: string;
  };
}

/** Cookie names of a Cookie header, sorted. */
export const names = (header: string) =>
  header
    .split(';')
    .map((part) => part.trim().split('=')[0]!)
    .filter(Boolean)
    .sort();
