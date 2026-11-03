import { parseHttpUrl } from './domains';
import type { Account, AppDef } from './types';

/**
 * "Open links with the right account": which saved account a page belongs to.
 *
 * An account's link rules are a host, optionally with a path prefix — the same
 * rules as Swapdeck Desktop's: "acme.example" also covers "app.acme.example";
 * "supabase.com/dashboard/project/abc" only that project. Besides its rules, an
 * account's recent items (by the app's `recentPattern` key, e.g. a Supabase
 * project ref) and pinned pages say which pages are its own.
 */

export const MAX_LINK_RULES = 20;

/** "https://www.Acme.example/Path/?q=1" → "acme.example/Path"; null when it isn't a host. */
export function normalizeLinkRule(text: string): string | null {
  let value = text.trim();
  const scheme = value.indexOf('://');
  if (scheme !== -1) value = value.slice(scheme + 3);
  if (value.startsWith('*.')) value = value.slice(2);
  const slash = value.indexOf('/');
  let host = (slash === -1 ? value : value.slice(0, slash)).toLowerCase();
  const at = host.lastIndexOf('@');
  if (at !== -1) host = host.slice(at + 1);
  const colon = host.indexOf(':');
  if (colon !== -1) host = host.slice(0, colon);
  if (host.startsWith('www.')) host = host.slice(4);
  if (
    !host ||
    host.length > 253 ||
    !host.includes('.') ||
    host.startsWith('.') ||
    host.endsWith('.') ||
    !/^[a-z0-9.-]+$/.test(host)
  ) {
    return null;
  }
  let path = slash === -1 ? '' : value.slice(slash);
  const cut = path.search(/[?#]/);
  if (cut !== -1) path = path.slice(0, cut);
  while (path.endsWith('/')) path = path.slice(0, -1);
  return (host + path).slice(0, 300);
}

/** Normalised, without duplicates, at most MAX_LINK_RULES. */
export function cleanLinkRules(rules: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const rule of rules) {
    const normalized = typeof rule === 'string' ? normalizeLinkRule(rule) : null;
    if (normalized && !out.includes(normalized)) out.push(normalized);
  }
  return out.slice(0, MAX_LINK_RULES);
}

type Target = { host: string; path: string };

function targetOf(url: string): Target | null {
  const parsed = parseHttpUrl(url);
  if (!parsed) return null;
  let host = parsed.hostname.toLowerCase();
  if (host.startsWith('www.')) host = host.slice(4);
  let path = parsed.pathname;
  while (path.endsWith('/')) path = path.slice(0, -1);
  return { host, path: path || '/' };
}

/** How well a rule matches a page (higher is more specific), or -1. */
export function ruleScore(rule: string, url: string): number {
  const normalized = normalizeLinkRule(rule);
  const target = targetOf(url);
  if (!normalized || !target) return -1;
  const slash = normalized.indexOf('/');
  const host = slash === -1 ? normalized : normalized.slice(0, slash);
  const path = slash === -1 ? '' : normalized.slice(slash);
  const exact = target.host === host;
  if (!exact && !target.host.endsWith(`.${host}`)) return -1;
  if (path && target.path !== path && !target.path.startsWith(`${path}/`)) return -1;
  return host.split('.').length * 100 + (exact ? 50 : 0) + path.length * 1000;
}

/** The key of the app's "recent item" in a page address (e.g. a Supabase project ref). */
export function recentKey(app: Pick<AppDef, 'recentPattern'>, url: string): string | null {
  if (!app.recentPattern) return null;
  const parsed = parseHttpUrl(url);
  if (!parsed) return null;
  try {
    return new RegExp(app.recentPattern).exec(parsed.pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Whether a pinned page covers a page: the same recent item when the app has
 * them, else the pinned address and everything under it — never a site's home
 * or sign-in page, which every account shares.
 */
function pinCovers(app: Pick<AppDef, 'recentPattern' | 'homeUrl' | 'loginUrl'>, pin: string, url: string): boolean {
  const key = recentKey(app, url);
  if (key) return recentKey(app, pin) === key;
  if (app.recentPattern && recentKey(app, pin)) return false;
  const pinned = targetOf(pin);
  const target = targetOf(url);
  if (!pinned || !target || pinned.path === '/' || pinned.host !== target.host) return false;
  const shared = [app.homeUrl, app.loginUrl].map((page) => (page ? targetOf(page) : null));
  if (shared.some((page) => page && page.host === pinned.host && page.path === pinned.path)) return false;
  return target.path === pinned.path || target.path.startsWith(`${pinned.path}/`);
}

export type LinkOwner = {
  accountId: string;
  /** What says so: one of its rules, or its recent items / pinned pages. */
  why: 'rule' | 'recent' | 'pin';
  /** The rule or the recent item's key that matched. */
  match: string;
};

/**
 * The account a page belongs to, when it isn't the one in use: by the
 * accounts' rules (the most specific wins), else by the only account whose
 * recent items or pinned pages include it. Null when the page belongs to the
 * account in use, to several accounts, or to none.
 */
export function linkOwner(
  app: Pick<AppDef, 'recentPattern' | 'homeUrl' | 'loginUrl'>,
  accounts: readonly Pick<Account, 'id' | 'linkRules' | 'recents' | 'pins'>[],
  url: string,
  activeId: string | null | undefined,
): LinkOwner | null {
  let best: { score: number; ids: Set<string>; rule: string } | null = null;
  for (const account of accounts) {
    for (const rule of account.linkRules ?? []) {
      const score = ruleScore(rule, url);
      if (score < 0) continue;
      if (!best || score > best.score) best = { score, ids: new Set([account.id]), rule };
      else if (score === best.score) best.ids.add(account.id);
    }
  }
  if (best) {
    if ((activeId && best.ids.has(activeId)) || best.ids.size > 1) return null;
    return { accountId: [...best.ids][0]!, why: 'rule', match: best.rule };
  }

  const key = recentKey(app, url);
  const owners = new Map<string, LinkOwner>();
  for (const account of accounts) {
    if (key && account.recents.some((recent) => recent.key === key)) {
      owners.set(account.id, { accountId: account.id, why: 'recent', match: key });
    } else {
      const pin = account.pins.find((item) => pinCovers(app, item.url, url));
      if (pin) owners.set(account.id, { accountId: account.id, why: 'pin', match: key ?? pin.url });
    }
  }
  if (owners.size !== 1 || (activeId && owners.has(activeId))) return null;
  return [...owners.values()][0]!;
}
