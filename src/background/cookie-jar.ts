import { dedupeCookies, toCookieRecord, toSetDetails } from '../core/cookies';
import { cookieUrl } from '../core/domains';
import type { CookieRecord } from '../core/types';

/** All cookies of the given domains and their subdomains (the default, non-incognito jar). */
export async function readCookies(domains: readonly string[]): Promise<CookieRecord[]> {
  const lists = await Promise.all(domains.map((domain) => chrome.cookies.getAll({ domain })));
  return dedupeCookies(lists.flat().map(toCookieRecord));
}

export async function clearCookies(domains: readonly string[]): Promise<number> {
  const cookies = await readCookies(domains);
  await Promise.all(
    cookies.map((cookie) => chrome.cookies.remove({ url: cookieUrl(cookie), name: cookie.name }).catch(() => null)),
  );
  return cookies.length;
}

/** Writes saved cookies back. Returns the names of cookies the browser refused. */
export async function writeCookies(cookies: readonly CookieRecord[]): Promise<string[]> {
  const failed: string[] = [];
  await Promise.all(
    cookies.map(async (cookie) => {
      const details = toSetDetails(cookie);
      if (!details) return;
      try {
        const result = await chrome.cookies.set(details);
        if (!result) failed.push(cookie.name);
      } catch {
        failed.push(cookie.name);
      }
    }),
  );
  return failed;
}
