import { cookieUrl } from './domains';
import type { CookieRecord } from './types';

type ChromeCookie = Pick<
  chrome.cookies.Cookie,
  'name' | 'value' | 'domain' | 'path' | 'secure' | 'httpOnly' | 'hostOnly' | 'session' | 'sameSite' | 'expirationDate'
>;

export function toCookieRecord(cookie: ChromeCookie): CookieRecord {
  const record: CookieRecord = {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    hostOnly: cookie.hostOnly,
    session: cookie.session,
    sameSite: cookie.sameSite as CookieRecord['sameSite'],
  };
  if (!cookie.session && cookie.expirationDate !== undefined) record.expirationDate = cookie.expirationDate;
  return record;
}

/** Identity of a cookie in the jar: the same name can exist per domain and path. */
export function cookieKey(cookie: Pick<CookieRecord, 'name' | 'domain' | 'path'>): string {
  return `${cookie.domain}\u0000${cookie.path}\u0000${cookie.name}`;
}

export function dedupeCookies(cookies: readonly CookieRecord[]): CookieRecord[] {
  const seen = new Map<string, CookieRecord>();
  for (const cookie of cookies) seen.set(cookieKey(cookie), cookie);
  return [...seen.values()];
}

/**
 * Turns a saved cookie back into chrome.cookies.set() details.
 * Returns null for cookies that have expired since they were saved.
 */
export function toSetDetails(cookie: CookieRecord, nowSeconds = Date.now() / 1000): chrome.cookies.SetDetails | null {
  if (!cookie.session && cookie.expirationDate !== undefined && cookie.expirationDate <= nowSeconds) return null;
  const details: chrome.cookies.SetDetails = {
    url: cookieUrl(cookie),
    name: cookie.name,
    value: cookie.value,
    path: cookie.path || '/',
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
  };
  // Host-only cookies must be set without a domain, or they'd become domain cookies.
  if (!cookie.hostOnly) details.domain = cookie.domain;
  if (cookie.sameSite !== 'unspecified') details.sameSite = cookie.sameSite;
  if (!cookie.session && cookie.expirationDate !== undefined) details.expirationDate = cookie.expirationDate;
  // Cookie prefixes have rules the browser enforces when setting them.
  if (cookie.name.startsWith('__Host-')) {
    delete details.domain;
    details.path = '/';
    details.secure = true;
  } else if (cookie.name.startsWith('__Secure-')) {
    details.secure = true;
  }
  if (details.secure) details.url = details.url.replace(/^http:/, 'https:');
  return details;
}
