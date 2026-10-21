import { describe, expect, it } from 'vitest';
import { dedupeCookies, toCookieRecord, toSetDetails } from '../../src/core/cookies';
import { cycleAccount, decideSave, isEmptySnapshot } from '../../src/core/decide';
import {
  appForUrl,
  cookieUrl,
  displayUrl,
  hostMatchesDomain,
  matchPatterns,
  normalizeDomain,
  registrableDomain,
} from '../../src/core/domains';
import { ACCENTS, DEFAULT_SETTINGS, parseSettings, vaultNudgeDue } from '../../src/core/settings';
import type { Account, CookieRecord, DetectorSpec, Identity } from '../../src/core/types';
import {
  ACCOUNT_COLORS,
  ACCOUNT_ICONS,
  COLOR_NAMES,
  contrastRatio,
  defaultLabel,
  initials,
  isAccountIcon,
  nextColor,
  readableTextColor,
  reorder,
} from '../../src/core/util';
import { en } from '../../src/i18n/en';

describe('domains', () => {
  it('finds the registrable domain, keeping hosting platforms and country suffixes apart', () => {
    expect(registrableDomain('app.supabase.com')).toBe('supabase.com');
    expect(registrableDomain('my-app.vercel.app')).toBe('my-app.vercel.app');
    expect(registrableDomain('x.y.up.railway.app')).toBe('y.up.railway.app');
    expect(registrableDomain('shop.tiki.com.vn')).toBe('tiki.com.vn');
    expect(registrableDomain('localhost')).toBe('localhost');
    expect(registrableDomain('192.168.1.10')).toBe('192.168.1.10');
  });

  it('normalises domain input', () => {
    expect(normalizeDomain('https://App.Example.com:8080/x?y')).toBe('app.example.com');
    expect(normalizeDomain('*.example.com')).toBe('example.com');
    expect(normalizeDomain('.example.com')).toBe('example.com');
    expect(normalizeDomain('exa mple.com')).toBeNull();
    expect(normalizeDomain('')).toBeNull();
    expect(normalizeDomain('localhost:3000')).toBe('localhost');
  });

  it('matches hosts to domains and URLs to apps (most specific wins)', () => {
    expect(hostMatchesDomain('dash.example.com', 'example.com')).toBe(true);
    expect(hostMatchesDomain('badexample.com', 'example.com')).toBe(false);
    const apps = [
      { id: 'a', domains: ['example.com'] },
      { id: 'b', domains: ['app.example.com'] },
    ];
    expect(appForUrl(apps, 'https://app.example.com/x')?.id).toBe('b');
    expect(appForUrl(apps, 'https://www.example.com/')?.id).toBe('a');
    expect(appForUrl(apps, 'chrome://extensions')).toBeNull();
    expect(appForUrl(apps, 'not a url')).toBeNull();
  });

  it('builds match patterns and cookie URLs', () => {
    expect(matchPatterns({ domains: ['supabase.com', 'localhost'] })).toEqual([
      '*://*.supabase.com/*',
      '*://localhost/*',
    ]);
    expect(cookieUrl({ domain: '.supabase.com', path: '/dashboard', secure: true })).toBe(
      'https://supabase.com/dashboard',
    );
    expect(cookieUrl({ domain: 'localhost', path: '', secure: false })).toBe('http://localhost/');
    expect(displayUrl('https://supabase.com/')).toBe('supabase.com');
    expect(displayUrl('https://supabase.com/dashboard?x=1')).toBe('supabase.com/dashboard?x=1');
  });
});

const cookie = (overrides: Partial<CookieRecord> = {}): CookieRecord => ({
  name: 'sid',
  value: 'v',
  domain: '.example.com',
  path: '/',
  secure: true,
  httpOnly: true,
  hostOnly: false,
  session: false,
  sameSite: 'lax',
  expirationDate: 4_000_000_000,
  ...overrides,
});

describe('cookies', () => {
  it('turns saved cookies back into set() details', () => {
    expect(toSetDetails(cookie())).toEqual({
      url: 'https://example.com/',
      name: 'sid',
      value: 'v',
      path: '/',
      secure: true,
      httpOnly: true,
      domain: '.example.com',
      sameSite: 'lax',
      expirationDate: 4_000_000_000,
    });
  });

  it('keeps host-only and session cookies as they were', () => {
    const details = toSetDetails(
      cookie({
        hostOnly: true,
        domain: 'app.example.com',
        session: true,
        expirationDate: undefined,
        sameSite: 'unspecified',
      }),
    )!;
    expect(details.domain).toBeUndefined();
    expect(details.expirationDate).toBeUndefined();
    expect(details.sameSite).toBeUndefined();
  });

  it('applies cookie prefix rules and skips expired cookies', () => {
    const host = toSetDetails(cookie({ name: '__Host-id', path: '/x', secure: false }))!;
    expect(host).toMatchObject({ path: '/', secure: true });
    expect(host.domain).toBeUndefined();
    expect(host.url.startsWith('https:')).toBe(true);
    expect(toSetDetails(cookie({ name: '__Secure-id', secure: false }))!.secure).toBe(true);
    expect(toSetDetails(cookie({ expirationDate: 100 }), 200)).toBeNull();
  });

  it('records chrome cookies and drops duplicates', () => {
    const record = toCookieRecord({
      name: 'a',
      value: '1',
      domain: 'x.com',
      path: '/',
      secure: false,
      httpOnly: false,
      hostOnly: true,
      session: true,
      sameSite: 'unspecified' as chrome.cookies.SameSiteStatus,
    });
    expect(record).not.toHaveProperty('expirationDate');
    expect(dedupeCookies([record, { ...record, value: '2' }])).toEqual([{ ...record, value: '2' }]);
  });
});

const account = (id: string, extra: Partial<Account> = {}): Account => ({
  id,
  appId: 'app',
  label: id,
  color: '#6d4cff',
  pins: [],
  recents: [],
  order: 0,
  createdAt: 0,
  switchCount: 0,
  ...extra,
});
const strong = (extra: Partial<Identity>): Identity => ({ confidence: 'strong', source: 'test', ...extra });

describe('decideSave', () => {
  const accounts = [account('a', { email: 'a@x.co' }), account('b', { email: 'b@x.co' }), account('c')];
  const specific: DetectorSpec = { kind: 'localStorage', keys: ['k'] };

  it('never saves an empty session', () => {
    expect(decideSave({ accounts, activeId: 'a', detector: specific, identity: null, empty: true })).toEqual({
      kind: 'skip',
      reason: 'empty',
    });
  });

  it('saves into the active account when it is the one signed in', () => {
    expect(
      decideSave({ accounts, activeId: 'a', detector: specific, identity: strong({ email: 'a@x.co' }), empty: false }),
    ).toEqual({ kind: 'active', accountId: 'a' });
  });

  it('saves into the account it belongs to when someone else signed in by hand', () => {
    expect(
      decideSave({ accounts, activeId: 'a', detector: specific, identity: strong({ email: 'B@x.co' }), empty: false }),
    ).toEqual({ kind: 'existing', accountId: 'b' });
  });

  it('keeps an unknown signed-in session as a new account', () => {
    expect(
      decideSave({
        accounts,
        activeId: 'a',
        detector: specific,
        identity: strong({ email: 'new@x.co' }),
        empty: false,
      }),
    ).toEqual({ kind: 'new' });
  });

  it('adopts an identity for an active account that has none yet', () => {
    expect(
      decideSave({
        accounts,
        activeId: 'c',
        detector: specific,
        identity: strong({ email: 'new@x.co' }),
        empty: false,
      }),
    ).toEqual({ kind: 'active', accountId: 'c' });
  });

  it('does not overwrite a saved session with a signed-out one', () => {
    expect(decideSave({ accounts, activeId: 'a', detector: specific, identity: null, empty: false })).toEqual({
      kind: 'skip',
      reason: 'signed-out',
    });
  });

  it('trusts the active account when identity cannot be detected', () => {
    expect(decideSave({ accounts, activeId: 'a', detector: { kind: 'auto' }, identity: null, empty: false })).toEqual({
      kind: 'active',
      accountId: 'a',
    });
    expect(
      decideSave({ accounts, activeId: null, detector: { kind: 'auto' }, identity: strong({}), empty: false }).kind,
    ).toBe('new');
    const weak: Identity = { confidence: 'weak', source: 'x', email: 'b@x.co' };
    expect(decideSave({ accounts, activeId: 'a', detector: { kind: 'auto' }, identity: weak, empty: false })).toEqual({
      kind: 'active',
      accountId: 'a',
    });
  });

  it('detects empty snapshots', () => {
    expect(isEmptySnapshot({ cookies: [], storage: {} })).toBe(true);
    expect(isEmptySnapshot({ cookies: [], storage: { localStorage: { a: '1' } } })).toBe(false);
  });
});

describe('cycleAccount', () => {
  const list = [account('a', { order: 0 }), account('b', { order: 1 }), account('c', { order: 2 })];
  it('wraps around in both directions', () => {
    expect(cycleAccount(list, 'c', 1)?.id).toBe('a');
    expect(cycleAccount(list, 'a', -1)?.id).toBe('c');
    expect(cycleAccount(list, null, 1)?.id).toBe('a');
    expect(cycleAccount(list, 'zzz', -1)?.id).toBe('c');
    expect(cycleAccount([], 'a', 1)).toBeNull();
  });
});

describe('settings', () => {
  it('falls back to defaults for unknown or invalid values', () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({ language: 'fr', theme: 'neon', autoLockMinutes: -4, autoSync: 'yes', extra: 1 })).toEqual(
      DEFAULT_SETTINGS,
    );
    expect(parseSettings({ language: 'vi', afterSwitch: 'home', autoLockMinutes: 0, badge: false })).toMatchObject({
      language: 'vi',
      afterSwitch: 'home',
      autoLockMinutes: 0,
      badge: false,
    });
  });

  it('reminds to lock saved sessions until snoozed or locked', () => {
    expect(parseSettings({ vaultNudgeUntil: 99 }).vaultNudgeUntil).toBe(99);
    expect(parseSettings({ vaultNudgeUntil: -1 }).vaultNudgeUntil).toBe(0);
    expect(parseSettings({ vaultNudgeUntil: 'soon' }).vaultNudgeUntil).toBe(0);
    expect(vaultNudgeDue({ vaultNudgeUntil: 0 }, false, 2, 10)).toBe(true);
    expect(vaultNudgeDue({ vaultNudgeUntil: 0 }, false, 1, 10)).toBe(false);
    expect(vaultNudgeDue({ vaultNudgeUntil: 0 }, true, 5, 10)).toBe(false);
    expect(vaultNudgeDue({ vaultNudgeUntil: 20 }, false, 5, 10)).toBe(false);
  });

  it('keeps known accents only', () => {
    for (const accent of ACCENTS) expect(parseSettings({ accent }).accent).toBe(accent);
    expect(parseSettings({ accent: 'neon' }).accent).toBe('son');
    expect(parseSettings({ accent: 42 }).accent).toBe('son');
  });
});

describe('palette and symbols', () => {
  it('names every pigment and keeps white text readable on it', () => {
    expect(new Set(ACCOUNT_COLORS).size).toBe(ACCOUNT_COLORS.length);
    for (const color of ACCOUNT_COLORS) {
      const name = COLOR_NAMES[color];
      expect(name, color).toBeDefined();
      expect(en).toHaveProperty(`color.${name}`);
      expect(contrastRatio('#ffffff', color)).toBeGreaterThanOrEqual(4.5);
      expect(readableTextColor(color)).toBe('#ffffff');
    }
    expect(readableTextColor('#f4f0e8')).toBe('#1a1714');
  });

  it('only accepts the known symbols', () => {
    for (const icon of ACCOUNT_ICONS) {
      expect(isAccountIcon(icon)).toBe(true);
      expect(en).toHaveProperty(`icon.${icon}`);
    }
    expect(isAccountIcon('skull')).toBe(false);
    expect(isAccountIcon(undefined)).toBe(false);
    expect(isAccountIcon('__proto__')).toBe(false);
  });
});

describe('util', () => {
  it('makes initials without accents', () => {
    expect(initials('Ngọc Ánh')).toBe('NA');
    expect(initials('Dự án phụ')).toBe('DA');
    expect(initials('Đặng')).toBe('ĐA');
    expect(initials('work')).toBe('WO');
    expect(initials('an@example.org')).toBe('AN');
    expect(initials('')).toBe('?');
  });

  it('suggests labels and colors', () => {
    expect(defaultLabel({ name: 'Tan', email: 't@x.co' }, 'Account 1')).toBe('Tan');
    expect(defaultLabel({ email: 'tan.dev@x.co' }, 'Account 1')).toBe('tan.dev');
    expect(defaultLabel(null, 'Account 1')).toBe('Account 1');
    expect(nextColor([{ color: ACCOUNT_COLORS[0]! }])).toBe(ACCOUNT_COLORS[1]);
  });

  it('reorders by id list and renumbers', () => {
    const items = [
      { id: 'a', order: 0 },
      { id: 'b', order: 1 },
      { id: 'c', order: 2 },
    ];
    expect(reorder(items, ['c', 'a'])).toEqual([
      { id: 'c', order: 0 },
      { id: 'a', order: 1 },
      { id: 'b', order: 2 },
    ]);
  });
});
