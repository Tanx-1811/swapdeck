import { isSealedBox } from './crypto';
import { normalizeDomain, parseHttpUrl } from './domains';
import { ACCOUNT_COLORS, isAccountIcon } from './util';
import type {
  Account,
  AppDef,
  CookieRecord,
  DetectorSpec,
  HistoryEntry,
  IdbDatabaseDump,
  Identity,
  IdentityFields,
  Pin,
  RecentItem,
  Snapshot,
  StorageKinds,
  StoredSnapshot,
  VaultMeta,
  WebStorageDump,
  Workspace,
} from './types';

/*
 * Everything read from storage or a backup file is untrusted: these functions
 * return a clean copy with only known fields, or null when the value is unusable.
 */

type Obj = Record<string, unknown>;

const FALLBACK_COLOR = ACCOUNT_COLORS[0]!;
const isObj = (value: unknown): value is Obj => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const str = (value: unknown, max = 2048): string | undefined =>
  typeof value === 'string' && value.length <= max ? value : undefined;
const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const HEX = /^#[0-9a-f]{6}$/i;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export const color = (value: unknown, fallback: string): string =>
  typeof value === 'string' && HEX.test(value) ? value.toLowerCase() : fallback;

function httpUrl(value: unknown): string | undefined {
  const text = str(value);
  return text && parseHttpUrl(text) ? text : undefined;
}

function stringList(value: unknown, max = 50, maxLength = 512): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length <= maxLength).slice(0, max)
    : [];
}

function fieldsOf(value: unknown): IdentityFields | undefined {
  if (!isObj(value)) return undefined;
  const fields: IdentityFields = {};
  for (const key of ['id', 'email', 'name', 'avatar'] as const) {
    const list = stringList(value[key], 20, 200);
    if (list.length) fields[key] = list;
  }
  return Object.keys(fields).length ? fields : undefined;
}

export function sanitizeDetector(value: unknown): DetectorSpec {
  if (!isObj(value)) return { kind: 'auto' };
  if (value.kind === 'none') return { kind: 'none' };
  if (value.kind === 'localStorage') {
    const keys = stringList(value.keys, 20, 300).filter(Boolean);
    if (keys.length) {
      const fields = fieldsOf(value.fields);
      return fields ? { kind: 'localStorage', keys, fields } : { kind: 'localStorage', keys };
    }
  }
  if (value.kind === 'cookie') {
    const names = stringList(value.names, 20, 300).filter(Boolean);
    const format = ['plain', 'json', 'jwt', 'supabase-ssr'].includes(value.format as string)
      ? (value.format as 'plain' | 'json' | 'jwt' | 'supabase-ssr')
      : 'plain';
    if (names.length) {
      const fields = fieldsOf(value.fields);
      return fields ? { kind: 'cookie', names, format, fields } : { kind: 'cookie', names, format };
    }
  }
  return { kind: 'auto' };
}

function storageKinds(value: unknown): StorageKinds {
  const input = isObj(value) ? value : {};
  return {
    cookies: input.cookies !== false,
    localStorage: input.localStorage !== false,
    sessionStorage: input.sessionStorage === true,
    indexedDB: input.indexedDB === true,
  };
}

function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

export function sanitizeApp(value: unknown): AppDef | null {
  if (!isObj(value)) return null;
  const id = str(value.id, 64);
  const name = str(value.name, 80)?.trim();
  const domains = stringList(value.domains, 20, 253)
    .map(normalizeDomain)
    .filter((domain): domain is string => Boolean(domain));
  const originUrl = parseHttpUrl(str(value.origin));
  if (!id || !ID.test(id) || !name || domains.length === 0 || !originUrl) return null;
  const origin = originUrl.origin;
  const stagingPath = str(value.stagingPath, 300);
  const recentPattern = str(value.recentPattern, 300);
  const app: AppDef = {
    id,
    name,
    color: color(value.color, FALLBACK_COLOR),
    domains: [...new Set(domains)],
    origin,
    homeUrl: httpUrl(value.homeUrl) ?? `${origin}/`,
    stagingPath: stagingPath?.startsWith('/') ? stagingPath : '/robots.txt',
    storage: storageKinds(value.storage),
    detector: sanitizeDetector(value.detector),
    order: num(value.order) ?? 0,
    createdAt: num(value.createdAt) ?? Date.now(),
  };
  const presetId = str(value.presetId, 64);
  if (presetId) app.presetId = presetId;
  const loginUrl = httpUrl(value.loginUrl);
  if (loginUrl) app.loginUrl = loginUrl;
  if (recentPattern && isValidRegex(recentPattern)) app.recentPattern = recentPattern;
  const titleSuffix = str(value.titleSuffix, 80);
  if (titleSuffix) app.titleSuffix = titleSuffix;
  return app;
}

function pins(value: unknown): Pin[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): Pin[] => {
    if (!isObj(item)) return [];
    const id = str(item.id, 64);
    const url = httpUrl(item.url);
    if (!id || !url) return [];
    return [{ id, url, title: str(item.title, 200) ?? url }];
  });
}

function recents(value: unknown): RecentItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): RecentItem[] => {
    if (!isObj(item)) return [];
    const key = str(item.key, 200);
    const url = httpUrl(item.url);
    if (!key || !url) return [];
    return [{ key, url, title: str(item.title, 200) ?? key, at: num(item.at) ?? 0 }];
  });
}

export function sanitizeAccount(value: unknown): Account | null {
  if (!isObj(value)) return null;
  const id = str(value.id, 64);
  const appId = str(value.appId, 64);
  const label = str(value.label, 120)?.trim();
  if (!id || !ID.test(id) || !appId || !label) return null;
  const account: Account = {
    id,
    appId,
    label,
    color: color(value.color, FALLBACK_COLOR),
    pins: pins(value.pins).slice(0, 30),
    recents: recents(value.recents).slice(0, 12),
    order: num(value.order) ?? 0,
    createdAt: num(value.createdAt) ?? Date.now(),
    switchCount: num(value.switchCount) ?? 0,
  };
  if (isAccountIcon(value.icon)) account.icon = value.icon;
  if (value.important === true) account.important = true;
  const optionalText = ['emoji', 'note', 'email', 'name', 'identityId'] as const;
  for (const key of optionalText) {
    const text = str(value[key], key === 'note' ? 1000 : 300);
    if (text) account[key] = text;
  }
  for (const key of ['avatarUrl', 'homeUrl', 'lastUrl'] as const) {
    const url = httpUrl(value[key]);
    if (url) account[key] = url;
  }
  if (account.avatarUrl && !account.avatarUrl.startsWith('https://')) delete account.avatarUrl;
  for (const key of ['lastUsedAt', 'capturedAt'] as const) {
    const time = num(value[key]);
    if (time !== undefined) account[key] = time;
  }
  if (isObj(value.stats)) {
    const stats = value.stats;
    account.stats = {
      cookies: num(stats.cookies) ?? 0,
      storageKeys: num(stats.storageKeys) ?? 0,
      databases: num(stats.databases) ?? 0,
      bytes: num(stats.bytes) ?? 0,
    };
  }
  return account;
}

const SAME_SITE = new Set(['no_restriction', 'lax', 'strict', 'unspecified']);

export function sanitizeCookie(value: unknown): CookieRecord | null {
  if (!isObj(value)) return null;
  const name = str(value.name, 4096);
  const cookieValue = str(value.value, 16_384);
  const domain = str(value.domain, 253);
  if (name === undefined || cookieValue === undefined || !domain) return null;
  const record: CookieRecord = {
    name,
    value: cookieValue,
    domain,
    path: str(value.path, 1024) ?? '/',
    secure: value.secure === true,
    httpOnly: value.httpOnly === true,
    hostOnly: value.hostOnly === true,
    session: value.session === true,
    sameSite: SAME_SITE.has(value.sameSite as string) ? (value.sameSite as CookieRecord['sameSite']) : 'unspecified',
  };
  const expires = num(value.expirationDate);
  if (!record.session && expires !== undefined) record.expirationDate = expires;
  return record;
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!isObj(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) if (typeof item === 'string') out[key] = item;
  return out;
}

function idbDumps(value: unknown): IdbDatabaseDump[] | undefined {
  if (!Array.isArray(value)) return undefined;
  // Structure is checked again, value by value, when it is written back in the page.
  return value.filter(
    (db): db is IdbDatabaseDump =>
      isObj(db) && typeof db.name === 'string' && typeof db.version === 'number' && Array.isArray(db.stores),
  );
}

export function sanitizeStorageDump(value: unknown): WebStorageDump {
  const input = isObj(value) ? value : {};
  const dump: WebStorageDump = {};
  const local = stringRecord(input.localStorage);
  if (local) dump.localStorage = local;
  const session = stringRecord(input.sessionStorage);
  if (session) dump.sessionStorage = session;
  const idb = idbDumps(input.indexedDB);
  if (idb) dump.indexedDB = idb;
  return dump;
}

export function sanitizeIdentity(value: unknown): Identity | undefined {
  if (!isObj(value)) return undefined;
  const identity: Identity = {
    confidence: value.confidence === 'weak' ? 'weak' : 'strong',
    source: str(value.source, 300) ?? '',
  };
  for (const key of ['id', 'email', 'name'] as const) {
    const text = str(value[key], 300);
    if (text) identity[key] = text;
  }
  const avatar = httpUrl(value.avatar);
  if (avatar?.startsWith('https://')) identity.avatar = avatar;
  return identity.id || identity.email || identity.name ? identity : undefined;
}

export function sanitizeSnapshot(value: unknown): Snapshot | null {
  if (!isObj(value) || value.v !== 1) return null;
  const origin = str(value.origin, 300);
  if (!origin || !Array.isArray(value.cookies)) return null;
  const snapshot: Snapshot = {
    v: 1,
    capturedAt: num(value.capturedAt) ?? 0,
    origin,
    cookies: value.cookies.map(sanitizeCookie).filter((cookie): cookie is CookieRecord => cookie !== null),
    storage: sanitizeStorageDump(value.storage),
  };
  const identity = sanitizeIdentity(value.identity);
  if (identity) snapshot.identity = identity;
  return snapshot;
}

export function sanitizeStoredSnapshot(value: unknown): StoredSnapshot | null {
  if (!isObj(value) || value.v !== 1) return null;
  if (isSealedBox(value.sealed)) return { v: 1, sealed: value.sealed };
  const plain = sanitizeSnapshot(value.plain);
  return plain ? { v: 1, plain } : null;
}

export function sanitizeHistory(value: unknown): HistoryEntry | null {
  if (!isObj(value)) return null;
  const id = str(value.id, 64);
  const at = num(value.at);
  const appId = str(value.appId, 64);
  const kinds = ['switch', 'fresh', 'save', 'auto-save', 'restore'];
  if (!id || at === undefined || !appId || !kinds.includes(value.kind as string)) return null;
  const entry: HistoryEntry = {
    id,
    at,
    kind: value.kind as HistoryEntry['kind'],
    appId,
    appName: str(value.appName, 120) ?? '',
    ok: value.ok !== false,
  };
  for (const key of ['fromId', 'toId'] as const) {
    if (value[key] === null) entry[key] = null;
    else if (str(value[key], 64)) entry[key] = value[key] as string;
  }
  for (const key of ['fromLabel', 'toLabel', 'error', 'via'] as const) {
    const text = str(value[key], 300);
    if (text) entry[key] = text;
  }
  return entry;
}

export function sanitizeWorkspace(value: unknown): Workspace | null {
  if (!isObj(value)) return null;
  const id = str(value.id, 64);
  const name = str(value.name, 80)?.trim();
  if (!id || !ID.test(id) || !name) return null;
  const members: Record<string, string> = {};
  if (isObj(value.members)) {
    for (const [appId, accountId] of Object.entries(value.members)) {
      if (ID.test(appId) && typeof accountId === 'string' && ID.test(accountId)) members[appId] = accountId;
    }
  }
  const workspace: Workspace = {
    id,
    name,
    color: color(value.color, FALLBACK_COLOR),
    members,
    links: pins(value.links).slice(0, 30),
    order: num(value.order) ?? 0,
    createdAt: num(value.createdAt) ?? Date.now(),
    switchCount: num(value.switchCount) ?? 0,
  };
  if (isAccountIcon(value.icon)) workspace.icon = value.icon;
  const emoji = str(value.emoji, 16);
  if (emoji) workspace.emoji = emoji;
  const note = str(value.note, 1000)?.trim();
  if (note) workspace.note = note;
  const lastUsedAt = num(value.lastUsedAt);
  if (lastUsedAt !== undefined) workspace.lastUsedAt = lastUsedAt;
  return workspace;
}

export function sanitizeVault(value: unknown): VaultMeta | null {
  if (!isObj(value) || value.v !== 1 || !isObj(value.privateKey)) return null;
  const salt = str(value.salt, 200);
  const publicKey = str(value.publicKey, 4000);
  const iterations = num(value.iterations);
  const iv = str(value.privateKey.iv, 200);
  const data = str(value.privateKey.data, 8000);
  if (!salt || !publicKey || !iterations || iterations < 100_000 || !iv || !data) return null;
  return { v: 1, salt, iterations, publicKey, privateKey: { iv, data }, createdAt: num(value.createdAt) ?? 0 };
}

export function sanitizeActive(value: unknown): Record<string, string | null> {
  if (!isObj(value)) return {};
  const out: Record<string, string | null> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === null || (typeof item === 'string' && ID.test(item))) out[key] = item;
  }
  return out;
}
