/**
 * Separate tabs (VI "tab riêng"): one account signed in in some tabs while the rest of the browser
 * keeps the account in use. Each separate tab belongs to a **lane** — the account's own cookie jar
 * and web storage, kept apart from the browser's:
 *
 * - cookies never reach Chrome's cookie store: declarativeNetRequest session rules limited to the
 *   lane's tabs set the `Cookie` header of every request to the app's sites from the lane's jar and
 *   drop `Set-Cookie` from the responses (the worker reads them first and updates the jar);
 * - the page's own view (document.cookie, localStorage, IndexedDB, BroadcastChannel, locks) is
 *   redirected by a script in the page's world to names under `__sdl:<token>:`, told which lane it
 *   is in, synchronously, by a `Server-Timing` entry the rules add to the lane's documents.
 *
 * Everything here is pure: parsing cookies (RFC 6265, the parts browsers follow), the jar, and the
 * rules for a lane. The worker side is `background/lanes.ts`; the page side `content/lane-main.ts`.
 */
import { hostMatchesDomain, isIpOrLocal, registrableDomain } from './domains';
import type { CookieRecord } from './types';

/** Prefix of a lane's localStorage keys, IndexedDB names, broadcast channels and locks. */
export const LANE_PREFIX = '__sdl:';
/** `__sdl:<token>:` — what a lane's names start with. */
export const laneNamespace = (token: string): string => `${LANE_PREFIX}${token}:`;
/** Name of the Server-Timing entry that tells a document which lane it is in. */
export const LANE_TIMING = 'swapdeck-lane';
export const LANE_TOKEN = /^[a-z0-9]{12}$/;

/** Session rule ids of lanes start here; lower ids belong to switches (guard.ts). */
export const LANE_RULE_BASE = 100_000;
/** Chrome allows 5,000 session rules in all; leave room for switches. */
export const LANE_RULE_BUDGET = 4_500;
/** Chrome allows 1,000 regex rules (dynamic and session together). */
export const LANE_REGEX_BUDGET = 900;

/** The largest name + value a browser keeps for one cookie. */
const MAX_COOKIE_SIZE = 4096;

export function newLaneToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

// --- Cookies -----------------------------------------------------------------

/** Whether a URL counts as secure for cookies (https/wss, or a local address, as Chrome treats them). */
export function isSecureUrl(url: URL): boolean {
  if (url.protocol === 'https:' || url.protocol === 'wss:') return true;
  const host = url.hostname;
  return host === 'localhost' || host.endsWith('.localhost') || /^127\.\d+\.\d+\.\d+$/.test(host) || host === '[::1]';
}

/** RFC 6265 §5.1.4: the directory of the request path. */
export function defaultPath(pathname: string): string {
  if (!pathname.startsWith('/')) return '/';
  const last = pathname.lastIndexOf('/');
  return last <= 0 ? '/' : pathname.slice(0, last);
}

/** RFC 6265 §5.1.4: whether a request path is within a cookie's path. */
export function pathMatches(requestPath: string, cookiePath: string): boolean {
  if (requestPath === cookiePath) return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith('/') || requestPath[cookiePath.length] === '/';
}

const bareDomain = (cookie: Pick<CookieRecord, 'domain'>) => cookie.domain.replace(/^\./, '').toLowerCase();

function expiryOf(attributes: Map<string, string>, nowSeconds: number): number | undefined {
  const maxAge = attributes.get('max-age');
  if (maxAge !== undefined && /^-?\d+$/.test(maxAge)) {
    const seconds = Number(maxAge);
    return seconds <= 0 ? 0 : nowSeconds + seconds;
  }
  const expires = attributes.get('expires');
  if (expires !== undefined) {
    const at = Date.parse(expires);
    if (Number.isFinite(at)) return at / 1000;
  }
  return undefined;
}

export type ParsedCookie = {
  cookie: CookieRecord;
  /** The line deletes the cookie (an expiry in the past). */
  expired: boolean;
};

/**
 * Parses a `Set-Cookie` header (`from: 'header'`) or a `document.cookie = …` assignment
 * (`from: 'script'`) made by `url`. Returns null for what a browser would ignore: a domain the
 * page can't set, a Secure cookie from an insecure page, broken cookie prefixes, HttpOnly from a
 * script, oversized cookies.
 */
export function parseCookie(
  line: string,
  url: URL,
  from: 'header' | 'script',
  nowSeconds = Date.now() / 1000,
): ParsedCookie | null {
  const [pair = '', ...parts] = line.split(';');
  const eq = pair.indexOf('=');
  const name = (eq === -1 ? '' : pair.slice(0, eq)).trim();
  const value = (eq === -1 ? pair : pair.slice(eq + 1)).trim();
  if (!name && !value) return null;
  if (name.length + value.length > MAX_COOKIE_SIZE) return null;
  // Control characters end a cookie line in browsers: refuse rather than guess.
  for (const char of name + value) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return null;
  }

  const attributes = new Map<string, string>();
  for (const part of parts) {
    const at = part.indexOf('=');
    const key = (at === -1 ? part : part.slice(0, at)).trim().toLowerCase();
    if (!key) continue;
    attributes.set(key, at === -1 ? '' : part.slice(at + 1).trim());
  }
  if (from === 'script' && attributes.has('httponly')) return null;

  const host = url.hostname.toLowerCase();
  let domain = host;
  let hostOnly = true;
  const domainAttribute = attributes.get('domain')?.replace(/^\./, '').toLowerCase();
  if (domainAttribute) {
    if (!hostMatchesDomain(host, domainAttribute)) return null;
    // An address can't share its cookies with "subdomains".
    if (isIpOrLocal(host) && domainAttribute !== host) return null;
    domain = `.${domainAttribute}`;
    hostOnly = false;
  }

  const pathAttribute = attributes.get('path');
  const path = pathAttribute?.startsWith('/') ? pathAttribute : defaultPath(url.pathname);
  const secure = attributes.has('secure');
  if (secure && !isSecureUrl(url)) return null;
  if (name.startsWith('__Secure-') && !secure) return null;
  if (name.startsWith('__Host-') && (!secure || !hostOnly || path !== '/')) return null;

  const sameSiteValue = attributes.get('samesite')?.toLowerCase();
  const sameSite: CookieRecord['sameSite'] =
    sameSiteValue === 'lax'
      ? 'lax'
      : sameSiteValue === 'strict'
        ? 'strict'
        : sameSiteValue === 'none'
          ? 'no_restriction'
          : 'unspecified';
  // Chrome rejects SameSite=None without Secure.
  if (sameSite === 'no_restriction' && !secure) return null;

  const expiry = expiryOf(attributes, nowSeconds);
  const cookie: CookieRecord = {
    name,
    value,
    domain,
    path,
    secure,
    httpOnly: from === 'header' && attributes.has('httponly'),
    hostOnly,
    session: expiry === undefined,
    sameSite,
  };
  if (expiry !== undefined) cookie.expirationDate = expiry;
  return { cookie, expired: expiry !== undefined && expiry <= nowSeconds };
}

const sameSlot = (a: CookieRecord, b: CookieRecord) =>
  a.name === b.name && a.path === b.path && bareDomain(a) === bareDomain(b) && a.hostOnly === b.hostOnly;

/**
 * Stores a parsed cookie in a jar (a new array; `changed` is false when nothing changed). A script
 * can't overwrite or delete an HttpOnly cookie.
 */
export function storeCookie(
  jar: readonly CookieRecord[],
  parsed: ParsedCookie,
  from: 'header' | 'script',
): { jar: CookieRecord[]; changed: boolean } {
  const index = jar.findIndex((item) => sameSlot(item, parsed.cookie));
  const existing = index === -1 ? null : jar[index]!;
  if (existing?.httpOnly && from === 'script') return { jar: [...jar], changed: false };
  if (parsed.expired) {
    if (!existing) return { jar: [...jar], changed: false };
    return { jar: jar.filter((_, i) => i !== index), changed: true };
  }
  const next = [...jar];
  if (existing) {
    const same =
      existing.value === parsed.cookie.value &&
      existing.secure === parsed.cookie.secure &&
      existing.httpOnly === parsed.cookie.httpOnly &&
      existing.sameSite === parsed.cookie.sameSite &&
      existing.expirationDate === parsed.cookie.expirationDate;
    if (same) return { jar: next, changed: false };
    next[index] = parsed.cookie;
  } else {
    next.push(parsed.cookie);
  }
  return { jar: next, changed: true };
}

const isExpired = (cookie: CookieRecord, nowSeconds: number) =>
  !cookie.session && cookie.expirationDate !== undefined && cookie.expirationDate <= nowSeconds;

/** The jar without cookies that have expired. */
export function purgeExpired(jar: readonly CookieRecord[], nowSeconds = Date.now() / 1000): CookieRecord[] {
  return jar.filter((cookie) => !isExpired(cookie, nowSeconds));
}

/**
 * Whether a browser keeps and sends a cookie of this name and value: not empty, not too large, a
 * name without separators or control characters, a value without ";" or control characters (tabs
 * aside). Anything else would break a Cookie header, or add cookies to it.
 */
export function sendableCookie(name: string, value: string): boolean {
  if ((!name && !value) || name.length + value.length > MAX_COOKIE_SIZE) return false;
  // eslint-disable-next-line no-control-regex
  return !/[;=\u0000-\u001f\u007f]/.test(name) && !/[;\u0000-\u0008\u000a-\u001f\u007f]/.test(value);
}

/** Only the cookies of the given sites, unexpired, one per name/domain/path, that can be sent. */
export function laneJar(
  cookies: readonly CookieRecord[],
  domains: readonly string[],
  nowSeconds = Date.now() / 1000,
): CookieRecord[] {
  const jar: CookieRecord[] = [];
  for (const cookie of cookies) {
    if (isExpired(cookie, nowSeconds) || !sendableCookie(cookie.name, cookie.value)) continue;
    if (!domains.some((domain) => hostMatchesDomain(bareDomain(cookie), domain))) continue;
    const index = jar.findIndex((item) => sameSlot(item, cookie));
    if (index === -1) jar.push(cookie);
    else jar[index] = cookie;
  }
  return jar;
}

/** Whether a request to `url` carries the cookie (domain, path, Secure, expiry; RFC 6265 §5.4). */
export function cookieApplies(cookie: CookieRecord, url: URL, nowSeconds = Date.now() / 1000): boolean {
  if (isExpired(cookie, nowSeconds)) return false;
  const host = url.hostname.toLowerCase();
  const domainOk = cookie.hostOnly ? host === bareDomain(cookie) : hostMatchesDomain(host, bareDomain(cookie));
  if (!domainOk) return false;
  if (!pathMatches(url.pathname || '/', cookie.path || '/')) return false;
  return !cookie.secure || isSecureUrl(url);
}

/** Cookies in the order browsers send them: longer paths first, then as stored. */
export function cookieHeader(cookies: readonly CookieRecord[]): string {
  return cookies
    .map((cookie, index) => ({ cookie, index }))
    .sort((a, b) => b.cookie.path.length - a.cookie.path.length || a.index - b.index)
    .map(({ cookie }) => (cookie.name ? `${cookie.name}=${cookie.value}` : cookie.value))
    .join('; ');
}

// --- SameSite --------------------------------------------------------------------

/**
 * How a cookie's SameSite works, as Chrome treats it: Strict, Lax (also a cookie that says nothing:
 * Lax by default, and None without Secure, which Chrome never keeps), or None.
 */
export function sameSiteKind(cookie: Pick<CookieRecord, 'sameSite' | 'secure'>): 'strict' | 'lax' | 'none' {
  if (cookie.sameSite === 'strict') return 'strict';
  return cookie.sameSite === 'no_restriction' && cookie.secure ? 'none' : 'lax';
}

/** A host's site (its registrable domain), as SameSite compares them. */
export const siteOf = (host: string): string => registrableDomain(host);

/** Whether two hosts are on the same site. */
export function sameSite(a: string, b: string): boolean {
  return siteOf(a) === siteOf(b);
}

/**
 * Whether a cookie may be set (by a response or a script) in a cross-site context — a frame or a
 * request of a page of another site: only SameSite=None cookies, as Chrome does.
 */
export function settableCrossSite(cookie: Pick<CookieRecord, 'sameSite' | 'secure'>): boolean {
  return sameSiteKind(cookie) === 'none';
}

/**
 * What `document.cookie` reads on a page at `url`; a frame embedded in another site's page (a
 * cross-site context) reads only the SameSite=None cookies.
 */
export function scriptCookies(
  jar: readonly CookieRecord[],
  url: URL,
  nowSeconds = Date.now() / 1000,
  crossSite = false,
): string {
  return cookieHeader(
    jar.filter(
      (cookie) =>
        !cookie.httpOnly && cookieApplies(cookie, url, nowSeconds) && (!crossSite || settableCrossSite(cookie)),
    ),
  );
}

/** How long Chrome sends a Lax-by-default cookie on a cross-site top-level POST after it was set (2 minutes). */
export const LAX_ALLOWING_UNSAFE_SECONDS = 120;

/**
 * The cookie headers a lane sends to one address, per kind of request (RFC 6265bis, as Chrome):
 * `full` on same-site requests (and the browser's own navigations: address bar, bookmarks),
 * `topGet` on a top-level GET navigation from another site (Strict cookies stay behind), `topUnsafe`
 * on a top-level POST… from another site (None, plus Lax-by-default cookies set in the last two
 * minutes), `cross` on everything else from another site (None only).
 */
export type CookieSets = {
  full: CookieRecord[];
  topGet: CookieRecord[];
  topUnsafe: CookieRecord[];
  cross: CookieRecord[];
};

export function cookieSets(
  cookies: readonly CookieRecord[],
  young: (cookie: CookieRecord) => boolean = () => false,
): CookieSets {
  const cross = cookies.filter((cookie) => sameSiteKind(cookie) === 'none');
  return {
    full: [...cookies],
    topGet: cookies.filter((cookie) => sameSiteKind(cookie) !== 'strict'),
    topUnsafe: cookies.filter(
      (cookie) => sameSiteKind(cookie) === 'none' || (cookie.sameSite === 'unspecified' && young(cookie)),
    ),
    cross,
  };
}

// --- Rules ---------------------------------------------------------------------

/** Where a set of rules applies: one host, or a domain with its subdomains. */
type Scope = { host: string; exact: boolean };

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/**
 * Regex for requests to a scope and path, over the given scheme(s). RE2, as declarativeNetRequest
 * uses. WebSockets count with their page's scheme (ws: like http:, wss: like https:): their
 * handshake carries cookies too, and a rule that missed it would let the browser's own go along.
 */
export function scopeRegex(scope: Scope, path: string, scheme: 'any' | 'https' | 'http'): string {
  const schemes = scheme === 'any' ? '(?:http|ws)s?' : scheme === 'https' ? '(?:https|wss)' : '(?:http|ws)';
  const host = scope.exact ? escapeRegex(scope.host) : `(?:[^/?#:@]+\\.)?${escapeRegex(scope.host)}`;
  const pathPart =
    path === '/' ? '(?:[/?#]|$)' : path.endsWith('/') ? escapeRegex(path) : `${escapeRegex(path)}(?:[/?#]|$)`;
  return `^${schemes}://${host}(?::[0-9]+)?${pathPart}`;
}

function cookieInScope(cookie: CookieRecord, scope: Scope): boolean {
  if (cookie.hostOnly) return scope.exact && scope.host === bareDomain(cookie);
  return hostMatchesDomain(scope.host, bareDomain(cookie));
}

const ALL_TYPES: chrome.declarativeNetRequest.ResourceType[] = [
  'main_frame',
  'sub_frame',
  'stylesheet',
  'script',
  'image',
  'font',
  'object',
  'xmlhttprequest',
  'ping',
  'csp_report',
  'media',
  'websocket',
  'webtransport',
  'webbundle',
  'other',
] as chrome.declarativeNetRequest.ResourceType[];
const PAGES = ['main_frame'] as chrome.declarativeNetRequest.ResourceType[];
const FRAMES = ['sub_frame'] as chrome.declarativeNetRequest.ResourceType[];
/** Responses that carry the signed-in person's data: never shared with the browser's cache. */
const NAVIGATIONS = ['main_frame', 'sub_frame'] as chrome.declarativeNetRequest.ResourceType[];
/**
 * The same for calls of the page (fetch, XHR…), where CORS applies: a header a rule adds that isn't
 * CORS-safelisted (cache-control, pragma, if-range) can make a cross-origin call need a preflight
 * its API doesn't answer. Rules only remove request headers there; lane-main.ts keeps the calls out
 * of the cache instead (fetch: no-store; same-origin XHR: the If-Range guard).
 */
const CALLS = ['xmlhttprequest', 'other'] as chrome.declarativeNetRequest.ResourceType[];
const GET = ['get'] as chrome.declarativeNetRequest.RequestMethod[];
/** The request's initiator is on the same site as its address (or isn't: another site, an opaque origin, none). */
const FIRST_PARTY = 'firstParty' as chrome.declarativeNetRequest.DomainType;
const THIRD_PARTY = 'thirdParty' as chrome.declarativeNetRequest.DomainType;

export type LaneRule = Omit<chrome.declarativeNetRequest.Rule, 'id'>;

/**
 * An If-Range value for a lane's own requests: with it, Chrome's HTTP cache passes the request
 * through (neither reads nor stores the answer), and a server ignores it (there is no Range).
 */
export const LANE_CACHE_GUARD = '"swapdeck-lane"';

const HEADER = {
  set: 'set' as chrome.declarativeNetRequest.HeaderOperation,
  remove: 'remove' as chrome.declarativeNetRequest.HeaderOperation,
};
const MODIFY = 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType;

/** The Server-Timing value that tells a document its lane and what document.cookie reads there. */
export function laneTiming(token: string, scriptCookieString: string): string {
  return `${LANE_TIMING};desc="${token}|${encodeURIComponent(scriptCookieString)}"`;
}

/** Reads `laneTiming` back (null when it isn't one). */
export function parseLaneTiming(description: string): { token: string; cookies: string } | null {
  const bar = description.indexOf('|');
  const token = bar === -1 ? description : description.slice(0, bar);
  if (!LANE_TOKEN.test(token)) return null;
  try {
    return { token, cookies: bar === -1 ? '' : decodeURIComponent(description.slice(bar + 1)) };
  } catch {
    return { token, cookies: '' };
  }
}

/** Priority of the rule that keeps a lane's cookies off calls from other sites' pages: above every other. */
const FOREIGN_CALLS_PRIORITY = 1_000_000;
/** SameSite levels of the cookie rules of one scope and path (cross, top-level, same-site, browser's own). */
const PRIORITY_LEVELS = 4;

/**
 * The session rules that make `tabIds` a lane over `domains` with cookie jar `jar`:
 *
 * - one rule drops `Set-Cookie` from every response of the lane's sites (the worker read them);
 * - two keep the lane's private responses (pages, API calls) out of the browser's cache, both ways:
 *   no cached copy of another account's page answers the lane, and the lane's pages aren't kept
 *   (calls only lose their conditional headers: rules never add an unsafe header where CORS applies);
 * - one names the lane to its frames (without cookies: see below);
 * - one keeps every cookie off calls (fetch, XHR) that pages of other sites make to the app's: a
 *   rule can't see whether such a call asks for credentials, and an answer with
 *   `Access-Control-Allow-Origin: *` to one that doesn't would be readable there;
 * - per scope (each app domain with its subdomains, each cookie's host or domain), per cookie path
 *   and per scheme when Secure cookies need it: the `Cookie` header, following SameSite as Chrome
 *   does (`cookieSets`) — all of the lane's cookies on same-site requests (an initiator of the same
 *   site and, from Chrome 145, a top-level page of that site), Lax and None on a top-level GET from
 *   another site, None only on anything else from another site; the header is removed where none of
 *   the lane's cookies goes, so the browser's own never go along; and for top-level pages the
 *   Server-Timing entry naming the lane, with what document.cookie reads there.
 *
 * Declarative rules can't tell a navigation the browser started itself (address bar, bookmark,
 * Swapdeck) from one another site started: both count as third-party and get the top-level GET set.
 * `navTabIds` are tabs whose next navigation is the browser's own (Swapdeck is about to navigate
 * them, or one went out without the lane's Strict cookies and is loaded again): they get every
 * cookie, as Chrome sends them.
 *
 * More specific scopes and paths have a higher priority: declarativeNetRequest applies the highest
 * rule that sets a header.
 */
export function laneRules(options: {
  token: string;
  tabIds: readonly number[];
  domains: readonly string[];
  jar: readonly CookieRecord[];
  nowSeconds?: number;
  /** Tabs whose next top-level navigation is the browser's own (see above). */
  navTabIds?: readonly number[];
  /** Chrome 145+: same-site also needs a top-level page of the site (`topDomains`). */
  topDomains?: boolean;
  /** Lax-by-default cookies set less than two minutes ago (Chrome sends them on a cross-site top-level POST). */
  young?: (cookie: CookieRecord) => boolean;
}): LaneRule[] {
  const { token, domains } = options;
  const tabIds = [...options.tabIds];
  const navTabIds = (options.navTabIds ?? []).filter((tabId) => tabIds.includes(tabId));
  const now = options.nowSeconds ?? Date.now() / 1000;
  const jar = laneJar(options.jar, domains, now);
  const rules: LaneRule[] = [
    {
      priority: 1,
      action: { type: MODIFY, responseHeaders: [{ header: 'set-cookie', operation: HEADER.remove }] },
      condition: { tabIds, requestDomains: [...domains], resourceTypes: ALL_TYPES },
    },
    {
      priority: 1,
      action: {
        type: MODIFY,
        requestHeaders: [
          { header: 'if-none-match', operation: HEADER.remove },
          { header: 'if-modified-since', operation: HEADER.remove },
          { header: 'cache-control', operation: HEADER.set, value: 'no-cache' },
          { header: 'pragma', operation: HEADER.set, value: 'no-cache' },
          // Chrome's HTTP cache neither reads nor stores a request with If-Range (servers ignore it
          // without Range): the response headers a rule changes come too late for the cache, which
          // would otherwise give the lane's page to the browser's own tabs.
          { header: 'if-range', operation: HEADER.set, value: LANE_CACHE_GUARD },
        ],
        responseHeaders: [{ header: 'cache-control', operation: HEADER.set, value: 'no-store' }],
      },
      condition: { tabIds, requestDomains: [...domains], resourceTypes: NAVIGATIONS },
    },
    {
      priority: 1,
      action: {
        type: MODIFY,
        requestHeaders: [
          // No revalidation answered "not modified" for a copy the browser's own account cached.
          { header: 'if-none-match', operation: HEADER.remove },
          { header: 'if-modified-since', operation: HEADER.remove },
        ],
        responseHeaders: [{ header: 'cache-control', operation: HEADER.set, value: 'no-store' }],
      },
      condition: { tabIds, requestDomains: [...domains], resourceTypes: CALLS },
    },
    {
      // Frames learn only their lane: a frame's timing can be visible to the page around it (with
      // Timing-Allow-Origin), so its document.cookie comes from the worker instead (lane-relay.ts).
      priority: 1,
      action: {
        type: MODIFY,
        responseHeaders: [{ header: 'server-timing', operation: HEADER.set, value: laneTiming(token, '') }],
      },
      condition: { tabIds, requestDomains: [...domains], resourceTypes: FRAMES },
    },
    {
      // Calls from pages of other sites (not the app's own): no cookie at all, the lane's or the browser's.
      priority: FOREIGN_CALLS_PRIORITY,
      action: { type: MODIFY, requestHeaders: [{ header: 'cookie', operation: HEADER.remove }] },
      condition: {
        tabIds,
        requestDomains: [...domains],
        excludedInitiatorDomains: [...domains],
        domainType: THIRD_PARTY,
        resourceTypes: CALLS,
      },
    },
  ];

  const scopes = new Map<string, Scope>();
  const addScope = (scope: Scope) => scopes.set(`${scope.exact ? '=' : '*'}${scope.host}`, scope);
  for (const domain of domains) addScope({ host: domain.toLowerCase(), exact: false });
  for (const cookie of jar) addScope({ host: bareDomain(cookie), exact: cookie.hostOnly });

  const cookieRule = (
    priority: number,
    cookies: readonly CookieRecord[],
    condition: chrome.declarativeNetRequest.RuleCondition,
  ): LaneRule => {
    const value = cookieHeader(cookies);
    return {
      priority,
      action: {
        type: MODIFY,
        requestHeaders: [
          value ? { header: 'cookie', operation: HEADER.set, value } : { header: 'cookie', operation: HEADER.remove },
        ],
      },
      condition,
    };
  };
  const same = (a: readonly CookieRecord[], b: readonly CookieRecord[]) => cookieHeader(a) === cookieHeader(b);

  for (const scope of scopes.values()) {
    const inScope = jar.filter((cookie) => cookieInScope(cookie, scope));
    const paths = new Set(['/', ...inScope.map((cookie) => cookie.path || '/')]);
    const specificity = scope.host.split('.').length * 2 + (scope.exact ? 1 : 0);
    const site = siteOf(scope.host);
    for (const path of paths) {
      const sends = inScope.filter((cookie) => pathMatches(path, cookie.path || '/'));
      // Local addresses count as secure over http too (as Chrome treats them): one rule for both.
      const local = isSecureUrl(new URL(`http://${scope.host}/`));
      const variants: { scheme: 'any' | 'https' | 'http'; cookies: CookieRecord[] }[] =
        !local && sends.some((cookie) => cookie.secure)
          ? [
              { scheme: 'https', cookies: sends },
              { scheme: 'http', cookies: sends.filter((cookie) => !cookie.secure) },
            ]
          : [{ scheme: 'any', cookies: sends }];
      // Room for the SameSite levels of this scope and path, all below the next more specific one.
      const base = (10 + specificity * 1000 + Math.min(path.length, 999)) * PRIORITY_LEVELS;
      for (const variant of variants) {
        const regexFilter = scopeRegex(scope, path, variant.scheme);
        const where = { tabIds, regexFilter, isUrlFilterCaseSensitive: true };
        const sets = cookieSets(variant.cookies, options.young);
        // Anything from another site: SameSite=None cookies only.
        rules.push(cookieRule(base, sets.cross, { ...where, resourceTypes: ALL_TYPES }));
        if (!same(sets.full, sets.cross)) {
          // A top-level navigation from another site: a GET carries Lax cookies too; a POST… only
          // None (and Lax-by-default cookies set in the last two minutes, as Chrome allows).
          if (!same(sets.topGet, sets.cross))
            rules.push(cookieRule(base + 1, sets.topGet, { ...where, resourceTypes: PAGES, requestMethods: GET }));
          if (!same(sets.topUnsafe, sets.cross))
            rules.push(
              cookieRule(base + 1, sets.topUnsafe, { ...where, resourceTypes: PAGES, excludedRequestMethods: GET }),
            );
          // Same-site: every cookie (for a top-level page, its top-level frame is the page itself).
          rules.push(
            cookieRule(base + 2, sets.full, {
              ...where,
              resourceTypes: ALL_TYPES,
              domainType: FIRST_PARTY,
              ...(options.topDomains ? { topDomains: [site] } : {}),
            }),
          );
          // The browser's own navigation of these tabs (Swapdeck's, or one loaded again): every cookie.
          if (navTabIds.length && !same(sets.full, sets.topGet))
            rules.push(
              cookieRule(base + 3, sets.full, {
                ...where,
                tabIds: navTabIds,
                resourceTypes: PAGES,
                requestMethods: GET,
              }),
            );
        }
        rules.push({
          priority: base,
          action: {
            type: MODIFY,
            responseHeaders: [
              {
                header: 'server-timing',
                operation: HEADER.set,
                value: laneTiming(token, cookieHeader(variant.cookies.filter((cookie) => !cookie.httpOnly))),
              },
            ],
          },
          condition: { ...where, resourceTypes: PAGES },
        });
      }
    }
  }
  return rules;
}

/** Rules of a lane that cover all its sites (no regex): Set-Cookie, the two cache rules, the frames' timing, foreign calls. */
export const LANE_WIDE_RULES = 5;

/** How many of a lane's rules use a regex (Chrome counts those separately). */
export const regexCount = (rules: readonly LaneRule[]) => rules.filter((rule) => rule.condition.regexFilter).length;
