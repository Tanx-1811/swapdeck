import { describe, expect, it } from 'vitest';
import {
  cookieApplies,
  cookieHeader,
  cookieSets,
  defaultPath,
  LANE_CACHE_GUARD,
  laneJar,
  laneRules,
  laneTiming,
  LANE_WIDE_RULES,
  LANE_TOKEN,
  newLaneToken,
  parseCookie,
  parseLaneTiming,
  pathMatches,
  purgeExpired,
  regexCount,
  sameSite,
  sameSiteKind,
  scopeRegex,
  scriptCookies,
  settableCrossSite,
  storeCookie,
  type LaneRule,
} from '../../src/core/lanes';
import type { CookieRecord } from '../../src/core/types';

const NOW = 1_800_000_000;
const url = (text: string) => new URL(text);

function parse(line: string, at = 'https://app.acme.test/dash/page', from: 'header' | 'script' = 'header') {
  return parseCookie(line, url(at), from, NOW);
}

function jarOf(...lines: [string, string?][]): CookieRecord[] {
  let jar: CookieRecord[] = [];
  for (const [line, at] of lines) {
    const parsed = parse(line, at);
    if (parsed) jar = storeCookie(jar, parsed, 'header').jar;
  }
  return jar;
}

/** A request as declarativeNetRequest sees it (defaults: a same-site call of the app's page, in the lane's first tab). */
type Request = {
  /** The initiator's origin; null when the browser started it (address bar, bookmark, an extension). */
  initiator?: string | null;
  method?: string;
  tabId?: number;
  /** The top-level page (for a top-level page: itself). */
  top?: string;
};

const domainListed = (host: string, list: readonly string[]) =>
  list.some((domain) => host === domain || host.endsWith(`.${domain}`));

/**
 * Which rule's header a request gets: the highest-priority matching rule, as Chrome applies it —
 * with its conditions as Chrome evaluates them (tabs, types, methods, initiator domains, first or
 * third party by site, top-level domains).
 */
function headerFor(
  rules: LaneRule[],
  requestUrl: string,
  header: string,
  type = 'xmlhttprequest',
  side: 'request' | 'response' | 'any' = 'any',
  request: Request = {},
): string | null {
  const url = new URL(requestUrl);
  // null: no initiator; 'null': an opaque one (a sandboxed frame, a data: page).
  const initiator =
    request.initiator === undefined
      ? new URL(url.origin)
      : request.initiator === null || request.initiator === 'null'
        ? null
        : new URL(request.initiator);
  const initiatorHost = initiator ? initiator.hostname : null;
  const top = type === 'main_frame' ? url : new URL(request.top ?? (initiatorHost ? initiator!.origin : url.origin));
  const method = (request.method ?? 'GET').toLowerCase();
  // By default, the lane's first tab.
  const tabId = request.tabId ?? rules[0]?.condition.tabIds?.[0] ?? -1;
  const matching = rules
    .filter((rule) => {
      const condition = rule.condition;
      if (condition.tabIds && !condition.tabIds.includes(tabId)) return false;
      if (condition.resourceTypes && !condition.resourceTypes.includes(type as never)) return false;
      if (condition.requestMethods && !condition.requestMethods.includes(method as never)) return false;
      if (condition.excludedRequestMethods?.includes(method as never)) return false;
      if (condition.regexFilter && !new RegExp(condition.regexFilter).test(requestUrl)) return false;
      if (condition.requestDomains && !domainListed(url.hostname, condition.requestDomains)) return false;
      // An opaque initiator, or none, only matches rules without a list of initiator domains.
      if (condition.initiatorDomains && !(initiatorHost && domainListed(initiatorHost, condition.initiatorDomains)))
        return false;
      if (
        condition.excludedInitiatorDomains &&
        initiatorHost &&
        domainListed(initiatorHost, condition.excludedInitiatorDomains)
      )
        return false;
      if (condition.domainType) {
        const firstParty = Boolean(initiatorHost) && sameSite(initiatorHost!, url.hostname);
        if ((condition.domainType === 'firstParty') !== firstParty) return false;
      }
      if (condition.topDomains && !domainListed(top.hostname, condition.topDomains)) return false;
      return true;
    })
    .sort((a, b) => (b.priority ?? 1) - (a.priority ?? 1));
  for (const rule of matching) {
    const all = [
      ...(side !== 'response' ? (rule.action.requestHeaders ?? []) : []),
      ...(side !== 'request' ? (rule.action.responseHeaders ?? []) : []),
    ];
    const found = all.find((item) => item.header === header);
    if (found) return found.operation === 'remove' ? '<removed>' : (found.value ?? '');
  }
  return null;
}

describe('cookie parsing (RFC 6265)', () => {
  it('reads name, value and attributes', () => {
    const parsed = parse('sid=abc; Path=/; Domain=.acme.test; Secure; HttpOnly; SameSite=Lax; Max-Age=60');
    expect(parsed).toEqual({
      expired: false,
      cookie: {
        name: 'sid',
        value: 'abc',
        domain: '.acme.test',
        path: '/',
        secure: true,
        httpOnly: true,
        hostOnly: false,
        session: false,
        sameSite: 'lax',
        expirationDate: NOW + 60,
      },
    });
  });

  it('defaults to a host-only session cookie on the directory of the page', () => {
    expect(parse('theme=dark')?.cookie).toMatchObject({
      domain: 'app.acme.test',
      hostOnly: true,
      path: '/dash',
      session: true,
      sameSite: 'unspecified',
    });
    expect(defaultPath('/')).toBe('/');
    expect(defaultPath('/a')).toBe('/');
    expect(defaultPath('/a/b/c')).toBe('/a/b');
  });

  it('refuses what a browser refuses', () => {
    expect(parse('x=1; Domain=other.test')).toBeNull();
    expect(parse('x=1; Domain=test')).not.toBeNull(); // a parent domain of the host (the app's rules limit it)
    expect(parse('x=1; Secure', 'http://app.acme.test/')).toBeNull();
    expect(parse('__Secure-x=1')).toBeNull();
    expect(parse('__Host-x=1; Secure; Path=/; Domain=acme.test')).toBeNull();
    expect(parse('__Host-x=1; Secure; Path=/')).not.toBeNull();
    expect(parse('x=1; HttpOnly', undefined, 'script')).toBeNull();
    expect(parse(`x=${'a'.repeat(5000)}`)).toBeNull();
    expect(parse('x=a\u0001b')).toBeNull();
    expect(parse('x=1; Domain=127.0.0.1', 'http://127.0.0.2/')).toBeNull();
    expect(parse('=')).toBeNull();
  });

  it('treats an expiry in the past as a deletion, Max-Age over Expires', () => {
    expect(parse('x=; Max-Age=0')?.expired).toBe(true);
    expect(parse('x=1; Expires=Thu, 01 Jan 1970 00:00:00 GMT')?.expired).toBe(true);
    expect(parse('x=1; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=100')?.expired).toBe(false);
  });

  it('accepts Secure cookies on local addresses', () => {
    expect(parse('x=1; Secure', 'http://localhost:3000/')).not.toBeNull();
    expect(parse('x=1; Secure', 'http://127.0.0.1/')).not.toBeNull();
  });
});

describe('the jar', () => {
  it('replaces the same cookie and deletes it with an expiry in the past', () => {
    let jar = jarOf(['sid=1; Path=/']);
    const replaced = storeCookie(jar, parse('sid=2; Path=/')!, 'header');
    expect(replaced.changed).toBe(true);
    expect(replaced.jar.map((cookie) => cookie.value)).toEqual(['2']);
    jar = replaced.jar;
    expect(storeCookie(jar, parse('sid=2; Path=/')!, 'header').changed).toBe(false);
    expect(storeCookie(jar, parse('sid=; Path=/; Max-Age=0')!, 'header').jar).toEqual([]);
    expect(storeCookie(jar, parse('other=; Max-Age=0')!, 'header').changed).toBe(false);
  });

  it('keeps cookies of other paths and domains apart', () => {
    const jar = jarOf(['a=1; Path=/'], ['a=2; Path=/admin'], ['a=3; Path=/; Domain=acme.test']);
    expect(jar).toHaveLength(3);
  });

  it('never lets a script overwrite or delete an HttpOnly cookie', () => {
    const jar = jarOf(['sid=server; Path=/; HttpOnly']);
    const fromScript = parse('sid=evil; Path=/', undefined, 'script')!;
    expect(storeCookie(jar, fromScript, 'script')).toEqual({ jar, changed: false });
    expect(storeCookie(jar, parse('sid=; Path=/; Max-Age=0', undefined, 'script')!, 'script').changed).toBe(false);
  });

  it('drops expired cookies and cookies of other sites', () => {
    const jar: CookieRecord[] = [
      { ...parse('a=1; Path=/')!.cookie },
      { ...parse('b=1; Path=/; Max-Age=10')!.cookie, expirationDate: NOW - 1 },
      { ...parse('c=1; Path=/')!.cookie, domain: 'other.test' },
    ];
    expect(purgeExpired(jar, NOW).map((cookie) => cookie.name)).toEqual(['a', 'c']);
    expect(laneJar(jar, ['acme.test'], NOW).map((cookie) => cookie.name)).toEqual(['a']);
  });
});

describe('cookies that can go in a header', () => {
  it('leaves out of a jar what would break the Cookie header of its rules', () => {
    const base = { domain: 'acme.test', path: '/', secure: false, httpOnly: false, hostOnly: true, session: true };
    const cookies: CookieRecord[] = [
      { ...base, name: 'ok', value: 'a=b\tc', sameSite: 'lax' },
      { ...base, name: 'inject', value: 'x; sid=evil', sameSite: 'lax' },
      { ...base, name: 'line', value: 'x\r\ny', sameSite: 'lax' },
      { ...base, name: 'big', value: 'x'.repeat(5000), sameSite: 'lax' },
      { ...base, name: 'a;b', value: '1', sameSite: 'lax' },
    ];
    expect(laneJar(cookies, ['acme.test'], NOW).map((cookie) => cookie.name)).toEqual(['ok']);
  });
});

describe('which cookies a request carries', () => {
  const jar = jarOf(
    ['root=1; Path=/; Domain=acme.test'],
    ['host=1; Path=/', 'https://app.acme.test/'],
    ['admin=1; Path=/admin', 'https://app.acme.test/'],
    ['sec=1; Path=/; Secure; HttpOnly', 'https://app.acme.test/'],
  );

  it('matches domain, path and Secure', () => {
    const names = (at: string) =>
      jar.filter((cookie) => cookieApplies(cookie, url(at), NOW)).map((cookie) => cookie.name);
    expect(names('https://app.acme.test/')).toEqual(['root', 'host', 'sec']);
    expect(names('https://app.acme.test/admin/users')).toEqual(['root', 'host', 'admin', 'sec']);
    expect(names('https://app.acme.test/administrator')).toEqual(['root', 'host', 'sec']);
    expect(names('http://app.acme.test/')).toEqual(['root', 'host']);
    expect(names('https://api.acme.test/')).toEqual(['root']);
    expect(names('https://deep.app.acme.test/')).toEqual(['root']);
  });

  it('sends longer paths first and hides HttpOnly cookies from scripts', () => {
    const forAdmin = jar.filter((cookie) => cookieApplies(cookie, url('https://app.acme.test/admin'), NOW));
    expect(cookieHeader(forAdmin)).toBe('admin=1; root=1; host=1; sec=1');
    expect(scriptCookies(jar, url('https://app.acme.test/admin'), NOW)).toBe('admin=1; root=1; host=1');
  });

  it('knows path matching', () => {
    expect(pathMatches('/a', '/a')).toBe(true);
    expect(pathMatches('/a/b', '/a')).toBe(true);
    expect(pathMatches('/ab', '/a')).toBe(false);
    expect(pathMatches('/a/b', '/a/')).toBe(true);
    expect(pathMatches('/', '/a')).toBe(false);
  });
});

describe('lane rules', () => {
  const token = 'abcdefghijkl';
  const jar = jarOf(
    ['root=1; Path=/; Domain=acme.test'],
    ['host=1; Path=/; HttpOnly', 'https://app.acme.test/'],
    ['admin=1; Path=/admin', 'https://app.acme.test/'],
    ['sec=1; Path=/; Secure; HttpOnly', 'https://app.acme.test/'],
  );
  const rules = laneRules({ token, tabIds: [7, 9], domains: ['acme.test'], jar, nowSeconds: NOW });

  it('limits every rule to the lane tabs', () => {
    for (const rule of rules) expect(rule.condition.tabIds).toEqual([7, 9]);
  });

  it('gives each request exactly the cookies the lane would send', () => {
    for (const at of [
      'https://app.acme.test/',
      'https://app.acme.test/admin/x?y=1',
      'https://app.acme.test/administrator',
      'http://app.acme.test/',
      'https://api.acme.test/v1',
      'https://acme.test/',
      'https://deep.app.acme.test/',
      'http://localhost.acme.test:8080/',
    ]) {
      const expected = cookieHeader(jar.filter((cookie) => cookieApplies(cookie, url(at), NOW)));
      expect(headerFor(rules, at, 'cookie'), at).toBe(expected || '<removed>');
    }
  });

  it('sends Secure cookies to local addresses over http, as Chrome does', () => {
    const local = jarOf(['sid=1; Path=/; Secure', 'http://localhost:3000/']);
    const localRules = laneRules({ token, tabIds: [1], domains: ['localhost'], jar: local, nowSeconds: NOW });
    expect(headerFor(localRules, 'http://localhost:3000/x', 'cookie')).toBe('sid=1');
  });

  it("removes the browser's own cookies where the lane has none", () => {
    const empty = laneRules({ token, tabIds: [1], domains: ['acme.test'], jar: [], nowSeconds: NOW });
    expect(headerFor(empty, 'https://app.acme.test/', 'cookie')).toBe('<removed>');
  });

  it('drops Set-Cookie and keeps private responses out of the cache', () => {
    expect(headerFor(rules, 'https://cdn.acme.test/x.js', 'set-cookie', 'script')).toBe('<removed>');
    expect(headerFor(rules, 'https://app.acme.test/', 'cache-control', 'main_frame', 'response')).toBe('no-store');
    expect(headerFor(rules, 'https://app.acme.test/', 'cache-control', 'main_frame', 'request')).toBe('no-cache');
    expect(headerFor(rules, 'https://app.acme.test/api', 'if-none-match')).toBe('<removed>');
    expect(headerFor(rules, 'https://cdn.acme.test/x.js', 'cache-control', 'script')).toBeNull();
  });

  it('tells documents their lane and what document.cookie reads there', () => {
    const timing = headerFor(rules, 'https://app.acme.test/admin', 'server-timing', 'main_frame');
    expect(timing).toBe(laneTiming(token, 'admin=1; root=1'));
    expect(headerFor(rules, 'https://app.acme.test/', 'server-timing', 'xmlhttprequest')).toBeNull();
    // Frames are told their lane, never its cookies.
    expect(headerFor(rules, 'https://app.acme.test/admin', 'server-timing', 'sub_frame')).toBe(laneTiming(token, ''));
    const description = /desc="([^"]*)"/.exec(timing!)![1]!;
    expect(parseLaneTiming(description)).toEqual({ token, cookies: 'admin=1; root=1' });
  });

  it('leaves other sites alone', () => {
    expect(headerFor(rules, 'https://other.test/', 'cookie')).toBeNull();
    expect(headerFor(rules, 'https://notacme.test/', 'cookie')).toBeNull();
  });

  it('builds anchored regexes', () => {
    const exact = new RegExp(scopeRegex({ host: 'app.acme.test', exact: true }, '/a', 'any'));
    expect(exact.test('https://app.acme.test/a')).toBe(true);
    expect(exact.test('https://app.acme.test:8443/a/b')).toBe(true);
    expect(exact.test('https://x.app.acme.test/a')).toBe(false);
    expect(exact.test('https://app.acme.test/ab')).toBe(false);
    expect(exact.test('https://evil.test/?https://app.acme.test/a')).toBe(false);
    const domain = new RegExp(scopeRegex({ host: 'acme.test', exact: false }, '/', 'https'));
    expect(domain.test('https://a.b.acme.test/')).toBe(true);
    expect(domain.test('https://notacme.test/')).toBe(false);
    expect(domain.test('http://acme.test/')).toBe(false);
    expect(domain.test('https://user@acme.test.evil.test/')).toBe(false);
  });

  it("gives WebSocket handshakes the lane's cookies, never the browser's", () => {
    for (const at of ['wss://app.acme.test/socket', 'ws://app.acme.test/socket', 'wss://api.acme.test/v1/live']) {
      const expected = cookieHeader(jar.filter((cookie) => cookieApplies(cookie, url(at), NOW)));
      expect(headerFor(rules, at, 'cookie', 'websocket'), at).toBe(expected || '<removed>');
    }
    // Secure cookies go over wss only, as over https.
    expect(headerFor(rules, 'wss://app.acme.test/', 'cookie', 'websocket')).toContain('sec=1');
    expect(headerFor(rules, 'ws://app.acme.test/', 'cookie', 'websocket')).not.toContain('sec=1');
    const empty = laneRules({ token, tabIds: [1], domains: ['acme.test'], jar: [], nowSeconds: NOW });
    expect(headerFor(empty, 'wss://acme.test/socket', 'cookie', 'websocket')).toBe('<removed>');
  });

  it('never adds a request header that would make a cross-origin call need a CORS preflight', () => {
    // CORS-safelisted request headers, and those a page can't set (the browser owns them).
    const allowed = new Set(['accept', 'accept-language', 'content-language', 'content-type', 'cookie']);
    for (const rule of rules) {
      const types = rule.condition.resourceTypes ?? [];
      if (types.every((type) => type === 'main_frame' || type === 'sub_frame')) continue;
      for (const header of rule.action.requestHeaders ?? []) {
        if (header.operation === 'remove') continue;
        expect(allowed.has(header.header), `${header.header} on ${types.join(',')}`).toBe(true);
      }
    }
    expect(headerFor(rules, 'https://api.acme.test/v1', 'cache-control', 'xmlhttprequest', 'request')).toBeNull();
    expect(headerFor(rules, 'https://api.acme.test/v1', 'pragma', 'xmlhttprequest', 'request')).toBeNull();
    expect(headerFor(rules, 'https://api.acme.test/v1', 'cache-control', 'xmlhttprequest', 'response')).toBe(
      'no-store',
    );
    expect(headerFor(rules, 'https://app.acme.test/', 'cache-control', 'sub_frame', 'request')).toBe('no-cache');
    // Pages pass Chrome's HTTP cache by (neither read nor kept): their response headers a rule sets
    // come too late for it.
    expect(headerFor(rules, 'https://app.acme.test/', 'if-range', 'main_frame', 'request')).toBe(LANE_CACHE_GUARD);
    expect(headerFor(rules, 'https://app.acme.test/', 'if-range', 'sub_frame', 'request')).toBe(LANE_CACHE_GUARD);
    expect(headerFor(rules, 'https://api.acme.test/v1', 'if-range', 'xmlhttprequest', 'request')).toBeNull();
  });

  it('stays small', () => {
    expect(regexCount(rules)).toBe(rules.length - LANE_WIDE_RULES);
    expect(rules.length).toBeLessThan(30);
    expect(regexCount(rules)).toBeLessThan(28);
  });
});

describe('SameSite in a lane (as Chrome applies it)', () => {
  const token = 'abcdefghijkl';
  const app = 'https://app.acme.test';
  const jar = jarOf(
    ['strict=1; Path=/; SameSite=Strict', `${app}/`],
    ['lax=1; Path=/; SameSite=Lax', `${app}/`],
    ['plain=1; Path=/', `${app}/`],
    ['none=1; Path=/; SameSite=None; Secure', `${app}/`],
  );
  const options = { token, tabIds: [7, 9], domains: ['acme.test'], jar, nowSeconds: NOW, topDomains: true };
  const rules = laneRules(options);
  const cookie = (type: string, request: Parameters<typeof headerFor>[5] = {}, url = `${app}/x`) =>
    headerFor(rules, url, 'cookie', type, 'request', request);
  const all = 'strict=1; lax=1; plain=1; none=1';
  const evil = 'https://evil.test';

  it('reads the kinds as Chrome does: no SameSite is Lax, None needs Secure', () => {
    expect(jar.map((item) => sameSiteKind(item))).toEqual(['strict', 'lax', 'lax', 'none']);
    expect(parse('x=1; SameSite=None')).toBeNull();
    expect(parse('x=1; SameSite=None', 'http://localhost/')).toBeNull();
    expect(parse('x=1; SameSite=None; Secure', 'http://localhost/')).not.toBeNull();
    expect(sameSiteKind({ sameSite: 'no_restriction', secure: false })).toBe('lax');
    expect(sameSite('app.acme.test', 'api.acme.test')).toBe(true);
    expect(sameSite('acme.test', 'evil.test')).toBe(false);
    expect(settableCrossSite(jar[3]!)).toBe(true);
    expect(jar.slice(0, 3).some(settableCrossSite)).toBe(false);
    const sets = cookieSets(jar, (item) => item.name === 'plain');
    expect(sets.topGet.map((item) => item.name)).toEqual(['lax', 'plain', 'none']);
    expect(sets.topUnsafe.map((item) => item.name)).toEqual(['plain', 'none']);
    expect(sets.cross.map((item) => item.name)).toEqual(['none']);
  });

  it("sends every cookie on the app's own requests", () => {
    for (const type of ['main_frame', 'sub_frame', 'xmlhttprequest', 'script', 'image', 'websocket'])
      expect(cookie(type), type).toBe(all);
    // A page of another origin of the same site counts as the same site.
    expect(cookie('xmlhttprequest', { initiator: 'https://www.acme.test' })).toBe(all);
    expect(cookie('main_frame', { initiator: app, method: 'POST' })).toBe(all);
  });

  it('follows SameSite for what another site starts', () => {
    // A link from another site: Lax goes, Strict stays behind.
    expect(cookie('main_frame', { initiator: evil })).toBe('lax=1; plain=1; none=1');
    // A form posted from another site: only None.
    expect(cookie('main_frame', { initiator: evil, method: 'POST' })).toBe('none=1');
    // Its frames, images and scripts: only None.
    for (const type of ['sub_frame', 'image', 'script', 'websocket'])
      expect(cookie(type, { initiator: evil, top: evil }), type).toBe('none=1');
  });

  it("keeps every cookie off calls other sites' pages make (they could read an answer allowed to any origin)", () => {
    for (const initiator of [evil, 'null'])
      expect(cookie('xmlhttprequest', { initiator, top: evil }), initiator).toBe('<removed>');
    // The app's own other sites keep calling it cross-site, with its None cookies.
    const twoSites = laneRules({ ...options, domains: ['acme.test', 'acme-api.test'] });
    expect(
      headerFor(twoSites, `${app}/x`, 'cookie', 'xmlhttprequest', 'request', {
        initiator: 'https://app.acme-api.test',
        top: 'https://app.acme-api.test',
      }),
    ).toBe('none=1');
  });

  it("treats a frame of the app inside another site's page as cross-site (Chrome 145+: topDomains)", () => {
    const fromFrame = { initiator: app, top: evil };
    expect(cookie('xmlhttprequest', fromFrame)).toBe('none=1');
    expect(cookie('sub_frame', fromFrame)).toBe('none=1');
    // Older Chrome can't see the top-level page: the frame's requests count as the app's own.
    const older = laneRules({ ...options, topDomains: false });
    expect(headerFor(older, `${app}/x`, 'cookie', 'xmlhttprequest', 'request', fromFrame)).toBe(all);
    expect(older.some((rule) => rule.condition.topDomains)).toBe(false);
    expect(rules.some((rule) => rule.condition.topDomains?.[0] === 'acme.test')).toBe(true);
  });

  it("gives the browser's own navigations every cookie once the tab is marked for them", () => {
    // Address bar, bookmark, Swapdeck: no initiator. Rules can't tell them from another site's link…
    expect(cookie('main_frame', { initiator: null })).toBe('lax=1; plain=1; none=1');
    // …so a tab Swapdeck is about to navigate (or loads again) gets them all, GET only.
    const marked = laneRules({ ...options, navTabIds: [9, 12] });
    const nav = (request: Parameters<typeof headerFor>[5]) =>
      headerFor(marked, `${app}/x`, 'cookie', 'main_frame', 'request', request);
    expect(nav({ initiator: null, tabId: 9 })).toBe(all);
    expect(nav({ initiator: null, tabId: 7 })).toBe('lax=1; plain=1; none=1');
    expect(nav({ initiator: evil, tabId: 9, method: 'POST' })).toBe('none=1');
    // A tab that isn't the lane's never gets a rule.
    expect(marked.some((rule) => rule.condition.tabIds?.includes(12))).toBe(false);
  });

  it('sends a Lax-by-default cookie on a cross-site top-level POST for two minutes after it was set', () => {
    const young = laneRules({ ...options, young: (item) => item.name === 'plain' || item.name === 'lax' });
    expect(
      headerFor(young, `${app}/callback`, 'cookie', 'main_frame', 'request', { initiator: evil, method: 'POST' }),
    ).toBe('plain=1; none=1');
  });

  it('needs no SameSite rules for a jar without Lax or Strict cookies', () => {
    const none = jarOf(['n=1; Path=/; SameSite=None; Secure', `${app}/`]);
    const plain = laneRules({ ...options, jar: none });
    // Per scope and scheme: the cookie rule and the page timing only.
    expect(plain.filter((rule) => rule.condition.regexFilter && rule.action.requestHeaders).length).toBe(
      plain.filter((rule) => rule.condition.regexFilter && rule.action.responseHeaders).length,
    );
    expect(headerFor(plain, `${app}/x`, 'cookie', 'image', 'request', { initiator: evil, top: evil })).toBe('n=1');
  });

  it('stays within the budget for a typical sign-in', () => {
    expect(rules.length).toBeLessThan(30);
    expect(regexCount(rules)).toBe(rules.length - LANE_WIDE_RULES);
  });
});

describe('tokens and timing', () => {
  it('makes random tokens of the expected shape', () => {
    const a = newLaneToken();
    expect(a).toMatch(LANE_TOKEN);
    expect(newLaneToken()).not.toBe(a);
  });

  it('rejects malformed timing', () => {
    expect(parseLaneTiming('nope')).toBeNull();
    expect(parseLaneTiming('abcdefghijkl|%E0%A4%A')).toEqual({ token: 'abcdefghijkl', cookies: '' });
    expect(parseLaneTiming('abcdefghijkl')).toEqual({ token: 'abcdefghijkl', cookies: '' });
  });
});

describe('the lane record (untrusted when read back)', () => {
  it('keeps valid lanes, drops broken ones and gives each tab one lane', async () => {
    const { sanitizeRegistry, summarize, laneTitle, sanitizeRestore } = await import('../../src/core/lane-registry');
    const registry = sanitizeRegistry({
      lanes: {
        a: {
          token: 'aaaaaaaaaaaa',
          kind: 'account',
          appId: 'app_1',
          accountId: 'acc_1',
          tabIds: [1, 2, 2, -1, 'x'],
          jar: [{ name: 'sid', value: '1', domain: 'acme.test' }, { bad: true }],
          ruleIds: [100000],
          title: 'Work · Acme',
          color: '#123456',
          groups: { '7': 3, nope: 4 },
          status: 'ok',
        },
        b: { token: 'bbbbbbbbbbbb', kind: 'scratch', appId: 'app_1', tabIds: [2, 3], color: 'red' },
        c: { token: 'short', kind: 'scratch', appId: 'app_1' },
        d: { token: 'dddddddddddd', kind: 'account', appId: 'app_1' },
        e: { token: 'eeeeeeeeeeee', kind: 'scratch', appId: '__proto__' },
      },
    });
    expect(Object.keys(registry.lanes).sort()).toEqual(['aaaaaaaaaaaa', 'bbbbbbbbbbbb']);
    const a = registry.lanes.aaaaaaaaaaaa!;
    expect(a.tabIds).toEqual([1, 2]);
    expect(a.jar).toHaveLength(1);
    expect(a.groups).toEqual({ '7': 3 });
    // Tab 2 already belongs to the first lane.
    expect(registry.lanes.bbbbbbbbbbbb!.tabIds).toEqual([3]);
    expect(registry.lanes.bbbbbbbbbbbb!.color).toBe('#6f665b');
    expect({ ...registry.tabs }).toEqual({ 1: 'aaaaaaaaaaaa', 2: 'aaaaaaaaaaaa', 3: 'bbbbbbbbbbbb' });
    expect(summarize(a)).not.toHaveProperty('jar');
    expect(laneTitle('x'.repeat(80), 'Acme')).toHaveLength(60);
    expect(
      sanitizeRestore([
        { token: 'aaaaaaaaaaaa', kind: 'account', appId: 'app_1', accountId: 'acc_1', title: 'Work · Acme' },
        { token: 'aaaaaaaaaaaa', kind: 'account', appId: 'app_1', title: 'no account' },
        { token: 'bad', appId: 'app_1', title: 't' },
        null,
      ]),
    ).toEqual([{ token: 'aaaaaaaaaaaa', kind: 'account', appId: 'app_1', accountId: 'acc_1', title: 'Work · Acme' }]);
  });
});
