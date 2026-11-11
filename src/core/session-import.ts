/**
 * Reading a sign-in exported by other tools, to save it as an account: the JSON of cookie
 * extensions (Cookie-Editor, EditThisCookie, chrome.cookies), Playwright's `storageState`
 * (cookies and the origin's localStorage), Netscape `cookies.txt` (curl, wget, yt-dlp), or a bare
 * `Cookie:` header. Only cookies of the app's own sites are kept, and expired ones are dropped.
 */
import { hostMatchesDomain, normalizeDomain } from './domains';
import { sendableCookie } from './lanes';
import type { CookieRecord } from './types';

export type ImportedSession = {
  format: 'json' | 'storage-state' | 'netscape' | 'header';
  cookies: CookieRecord[];
  /** The main origin's localStorage, when the export has it (Playwright). */
  localStorage?: Record<string, string>;
  /** Cookies left out: other sites, expired, unreadable. */
  skipped: number;
};

/** Larger pastes aren't sign-ins. */
export const MAX_IMPORT_LENGTH = 2_000_000;

// A Map: a value like "constructor" or "__proto__" must not find anything of an object's prototype.
const SAME_SITE = new Map<string, CookieRecord['sameSite']>([
  ['lax', 'lax'],
  ['strict', 'strict'],
  ['none', 'no_restriction'],
  ['no_restriction', 'no_restriction'],
  ['unspecified', 'unspecified'],
]);

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length <= max ? value : null;
}

/** One cookie object as the common exporters write it; null when it can't be used. */
function fromObject(value: unknown): CookieRecord | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const name = text(item.name, 4096);
  const cookieValue = text(item.value, 16_384);
  const rawDomain = text(item.domain, 253) ?? text(item.host, 253);
  if (name === null || cookieValue === null || !rawDomain) return null;
  // Separators or control characters would break the Cookie header (or add cookies to it).
  if (!sendableCookie(name, cookieValue)) return null;
  const bare = normalizeDomain(rawDomain);
  if (!bare) return null;
  // Exports mark domain cookies with a leading dot, or hostOnly: false.
  const hostOnly =
    typeof item.hostOnly === 'boolean' ? item.hostOnly : !rawDomain.startsWith('.') && item.includeSubdomains !== true;
  const expiry = [item.expirationDate, item.expires, item.expiry].find(
    (candidate): candidate is number => typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0,
  );
  const sameSiteRaw = typeof item.sameSite === 'string' ? item.sameSite.toLowerCase() : 'unspecified';
  const cookie: CookieRecord = {
    name,
    value: cookieValue,
    domain: hostOnly ? bare : `.${bare}`,
    path: text(item.path, 1024)?.startsWith('/') ? (item.path as string) : '/',
    secure: item.secure === true,
    httpOnly: item.httpOnly === true,
    hostOnly,
    session: expiry === undefined || item.session === true,
    sameSite: SAME_SITE.get(sameSiteRaw) ?? 'unspecified',
  };
  if (!cookie.session && expiry !== undefined) cookie.expirationDate = expiry;
  return cookie;
}

/** Netscape cookies.txt: domain, include subdomains, path, secure, expiry, name, value (tab-separated). */
function fromNetscape(input: string): { cookies: CookieRecord[]; bad: number } {
  const cookies: CookieRecord[] = [];
  let bad = 0;
  for (const raw of input.split(/\r?\n/)) {
    let line = raw;
    let httpOnly = false;
    if (line.startsWith('#HttpOnly_')) {
      httpOnly = true;
      line = line.slice('#HttpOnly_'.length);
    } else if (!line.trim() || line.startsWith('#')) {
      continue;
    }
    const parts = line.split('\t');
    if (parts.length < 7) {
      bad++;
      continue;
    }
    const [domain, subdomains, path, secure, expires, name, ...rest] = parts;
    const cookie = fromObject({
      domain,
      includeSubdomains: subdomains?.toUpperCase() === 'TRUE',
      hostOnly: !(subdomains?.toUpperCase() === 'TRUE' || domain?.startsWith('.')),
      path,
      secure: secure?.toUpperCase() === 'TRUE',
      httpOnly,
      expires: Number(expires) || undefined,
      name,
      value: rest.join('\t'),
    });
    if (cookie) cookies.push(cookie);
    else bad++;
  }
  return { cookies, bad };
}

/** `a=1; b=2` (optionally starting with "Cookie:"), as host-only cookies of the main origin. */
function fromHeader(input: string, host: string): CookieRecord[] {
  const header = input.replace(/^\s*cookie:\s*/i, '').trim();
  const cookies: CookieRecord[] = [];
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const cookie = fromObject({
      name: part.slice(0, eq).trim(),
      value: part.slice(eq + 1).trim(),
      domain: host,
      hostOnly: true,
      path: '/',
      secure: true,
    });
    if (cookie) cookies.push(cookie);
  }
  return cookies;
}

/**
 * Reads an exported sign-in for an app (its cookie `domains` and main `origin`). Returns null
 * when the text isn't any of the known formats.
 */
export function parseSessionExport(
  input: string,
  app: { domains: readonly string[]; origin: string },
  nowSeconds = Date.now() / 1000,
): ImportedSession | null {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > MAX_IMPORT_LENGTH) return null;
  const host = new URL(app.origin).hostname;

  let format: ImportedSession['format'];
  let candidates: CookieRecord[] = [];
  let bad = 0;
  let localStorage: Record<string, string> | undefined;

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    let value: unknown;
    try {
      value = JSON.parse(trimmed);
    } catch {
      return null;
    }
    let list: unknown[];
    if (Array.isArray(value)) {
      format = 'json';
      list = value;
    } else if (value && typeof value === 'object' && Array.isArray((value as { cookies?: unknown }).cookies)) {
      const state = value as { cookies: unknown[]; origins?: unknown };
      format = Array.isArray(state.origins) ? 'storage-state' : 'json';
      list = state.cookies;
      if (Array.isArray(state.origins)) {
        for (const origin of state.origins) {
          const entry = origin as { origin?: unknown; localStorage?: unknown };
          if (entry?.origin !== app.origin || !Array.isArray(entry.localStorage)) continue;
          localStorage = Object.create(null) as Record<string, string>;
          for (const pair of entry.localStorage) {
            const key = text((pair as { name?: unknown })?.name, 4096);
            const stored = text((pair as { value?: unknown })?.value, 5_000_000);
            if (key !== null && stored !== null) localStorage[key] = stored;
          }
        }
      }
    } else {
      return null;
    }
    for (const item of list.slice(0, 5000)) {
      const cookie = fromObject(item);
      if (cookie) candidates.push(cookie);
      else bad++;
    }
  } else if (trimmed.includes('\t')) {
    format = 'netscape';
    ({ cookies: candidates, bad } = fromNetscape(trimmed));
  } else if (/^(cookie:\s*)?[^=;\s]+=/i.test(trimmed) && !trimmed.includes('\n')) {
    format = 'header';
    candidates = fromHeader(trimmed, host);
  } else {
    return null;
  }

  const seen = new Map<string, CookieRecord>();
  let skipped = bad;
  for (const cookie of candidates) {
    const bare = cookie.domain.replace(/^\./, '');
    const ours = app.domains.some((domain) => hostMatchesDomain(bare, domain));
    const expired = !cookie.session && cookie.expirationDate !== undefined && cookie.expirationDate <= nowSeconds;
    if (!ours || expired) {
      skipped++;
      continue;
    }
    seen.set(`${cookie.domain}\u0000${cookie.path}\u0000${cookie.name}`, cookie);
  }
  return {
    format,
    cookies: [...seen.values()],
    ...(localStorage ? { localStorage } : {}),
    skipped,
  };
}
