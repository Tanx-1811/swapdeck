import type { Account, CookieRecord, DetectorSpec, Identity, IdentityFields } from './types';

/** What detection looks at: the captured cookies and local storage of the site. */
export type DetectionInput = {
  cookies: readonly CookieRecord[];
  localStorage?: Readonly<Record<string, string>>;
};

const DEFAULT_FIELDS: Required<IdentityFields> = {
  id: ['user.id', 'sub', 'user_id', 'uid', 'userId', 'user.uid', 'id'],
  email: ['user.email', 'email', 'user.user_metadata.email', 'emailAddress', 'user.emailAddress', 'primaryEmail'],
  name: [
    'user.user_metadata.full_name',
    'user.user_metadata.name',
    'user.user_metadata.user_name',
    'user.name',
    'user.username',
    'name',
    'displayName',
    'username',
    'login',
  ],
  avatar: [
    'user.user_metadata.avatar_url',
    'user.user_metadata.picture',
    'user.avatar_url',
    'picture',
    'avatar_url',
    'avatarUrl',
    'photoURL',
  ],
};

/** Values larger than this are never parsed while guessing (caches, not sign-in records). */
const MAX_SCAN_LENGTH = 200_000;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const JWT = /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*$/;
const AUTH_KEY = /auth|token|session|jwt|id_token|access|credential|login/i;
const USER_KEY = /user|auth|session|account|profile|member|me$|viewer|identity/i;

export function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

export function readPath(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const part of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function base64UrlDecode(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function decodeJwt(token: string): Record<string, unknown> | null {
  const trimmed = token.trim().replace(/^bearer\s+/i, '');
  if (!JWT.test(trimmed)) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(trimmed.split('.')[1]!)) as unknown;
    return payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Parses a stored value: JSON (also double-encoded or URL-encoded), a JWT, or Supabase's "base64-" format. */
export function parseStoredValue(raw: string): unknown {
  let text = raw.trim();
  if (text.startsWith('base64-')) {
    try {
      text = base64UrlDecode(text.slice('base64-'.length));
    } catch {
      return null;
    }
  }
  if (/^%7B|^%5B|^%22/i.test(text)) {
    try {
      text = decodeURIComponent(text);
    } catch {
      // Keep the raw text.
    }
  }
  if (JWT.test(text)) return decodeJwt(text);
  if (!/^[[{"]/.test(text)) return null;
  try {
    let parsed: unknown = JSON.parse(text);
    if (typeof parsed === 'string' && /^[[{]/.test(parsed.trim())) parsed = JSON.parse(parsed);
    return parsed;
  } catch {
    return null;
  }
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function firstField(value: unknown, paths: readonly string[]): string | undefined {
  for (const path of paths) {
    const found = asString(readPath(value, path));
    if (found) return found;
  }
  return undefined;
}

/** Emails also hide in namespaced claims, e.g. Auth0's "https://example.com/email". */
function namespacedEmail(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  for (const [key, claim] of Object.entries(value as Record<string, unknown>)) {
    if (/email$/i.test(key) && typeof claim === 'string' && EMAIL.test(claim)) return claim;
  }
  return undefined;
}

type PartialIdentity = Omit<Identity, 'confidence' | 'source'>;

/**
 * Reads identity fields out of a parsed sign-in record. Understands session
 * objects that keep the user only inside their access token (Supabase with a
 * separate user store) and the array form older Supabase cookies used.
 */
export function identityFromValue(value: unknown, fields: IdentityFields = {}): PartialIdentity | null {
  if (Array.isArray(value)) {
    const token = value.find((item) => typeof item === 'string' && JWT.test(item));
    return token ? identityFromValue(decodeJwt(token), fields) : null;
  }
  if (!value || typeof value !== 'object') return null;

  const paths = {
    id: fields.id ?? DEFAULT_FIELDS.id,
    email: fields.email ?? DEFAULT_FIELDS.email,
    name: fields.name ?? DEFAULT_FIELDS.name,
    avatar: fields.avatar ?? DEFAULT_FIELDS.avatar,
  };
  let email = firstField(value, paths.email) ?? namespacedEmail(value);
  if (email && !EMAIL.test(email)) email = undefined;
  const identity: PartialIdentity = {
    id: firstField(value, paths.id),
    email,
    name: firstField(value, paths.name),
    avatar: firstField(value, paths.avatar),
  };

  // A session object whose user lives elsewhere still carries it in the access token.
  const accessToken = readPath(value, 'access_token');
  if ((!identity.email || !identity.id) && typeof accessToken === 'string') {
    const claims = identityFromValue(decodeJwt(accessToken), fields);
    if (claims) {
      identity.email ??= claims.email;
      identity.id ??= claims.id;
      identity.name ??= claims.name;
    }
  }
  if (identity.avatar && !/^https:\/\//.test(identity.avatar)) identity.avatar = undefined;
  return identity.email || identity.id || identity.name ? identity : null;
}

function merge(target: PartialIdentity, extra: PartialIdentity): PartialIdentity {
  return {
    id: target.id ?? extra.id,
    email: target.email ?? extra.email,
    name: target.name ?? extra.name,
    avatar: target.avatar ?? extra.avatar,
  };
}

function finish(found: PartialIdentity | null, confidence: Identity['confidence'], source: string): Identity | null {
  if (!found) return null;
  const identity: Identity = { confidence, source };
  if (found.id) identity.id = found.id;
  if (found.email) identity.email = found.email;
  if (found.name) identity.name = found.name;
  if (found.avatar) identity.avatar = found.avatar;
  return identity;
}

/** Joins chunked cookies ("name.0", "name.1", …) the way @supabase/ssr splits large sessions. */
export function joinCookieChunks(
  cookies: readonly CookieRecord[],
  matches: (name: string) => boolean,
): Map<string, string> {
  const groups = new Map<string, { index: number; value: string }[]>();
  for (const cookie of cookies) {
    const chunk = /^(.*)\.(\d+)$/.exec(cookie.name);
    const base = chunk && matches(chunk[1]!) ? chunk[1]! : cookie.name;
    if (!matches(base) && !matches(cookie.name)) continue;
    const index = chunk && base === chunk[1] ? Number(chunk[2]) : -1;
    const list = groups.get(base) ?? [];
    list.push({ index, value: cookie.value });
    groups.set(base, list);
  }
  const joined = new Map<string, string>();
  for (const [name, parts] of groups) {
    const whole = parts.find((part) => part.index === -1);
    joined.set(
      name,
      whole
        ? whole.value
        : parts
            .sort((a, b) => a.index - b.index)
            .map((part) => part.value)
            .join(''),
    );
  }
  return joined;
}

function detectLocalStorage(
  storage: Readonly<Record<string, string>>,
  keys: readonly string[],
  fields?: IdentityFields,
): Identity | null {
  let found: PartialIdentity | null = null;
  const sources: string[] = [];
  for (const pattern of keys) {
    const regex = wildcardToRegExp(pattern);
    for (const key of Object.keys(storage).sort()) {
      if (!regex.test(key)) continue;
      const identity = identityFromValue(parseStoredValue(storage[key]!), fields);
      if (!identity) continue;
      found = found ? merge(found, identity) : identity;
      sources.push(key);
    }
  }
  return finish(found, 'strong', `localStorage: ${sources.join(', ')}`);
}

function detectCookie(
  cookies: readonly CookieRecord[],
  names: readonly string[],
  format: 'plain' | 'json' | 'jwt' | 'supabase-ssr',
  fields?: IdentityFields,
): Identity | null {
  const regexes = names.map(wildcardToRegExp);
  const joined = joinCookieChunks(cookies, (name) => regexes.some((regex) => regex.test(name)));
  for (const [name, raw] of joined) {
    let value: string = raw;
    try {
      value = decodeURIComponent(raw);
    } catch {
      // Keep the raw value.
    }
    if (format === 'plain') {
      const text = value.trim();
      if (!text) continue;
      return finish(
        EMAIL.test(text) ? { id: text, email: text } : { id: text, name: text },
        'strong',
        `cookie: ${name}`,
      );
    }
    const parsed = format === 'jwt' ? decodeJwt(value) : parseStoredValue(value);
    const identity = identityFromValue(parsed, fields);
    if (identity) return finish(identity, 'strong', `cookie: ${name}`);
  }
  return null;
}

/** Best-effort detection for sites without a known recipe. */
function detectAuto(input: DetectionInput): Identity | null {
  const storage = input.localStorage ?? {};

  // Supabase-powered apps (supabase-js keeps the session in local storage).
  const supabaseLocal = detectLocalStorage(storage, ['sb-*-auth-token', 'sb-*-auth-token-user']);
  if (supabaseLocal) return supabaseLocal;

  // Supabase-powered apps using @supabase/ssr (session in cookies, possibly chunked).
  const supabaseCookie = detectCookie(input.cookies, ['sb-*-auth-token'], 'supabase-ssr');
  if (supabaseCookie) return supabaseCookie;

  // Firebase Auth with local storage persistence.
  const firebase = detectLocalStorage(storage, ['firebase:authUser:*']);
  if (firebase) return firebase;

  // A JWT with an email claim in a cookie or entry named like a credential.
  for (const cookie of input.cookies) {
    if (!AUTH_KEY.test(cookie.name) || cookie.value.length > MAX_SCAN_LENGTH) continue;
    const claims = decodeJwt(cookie.value);
    const identity = claims && identityFromValue(claims);
    if (identity?.email) return finish(identity, 'strong', `cookie: ${cookie.name}`);
  }
  for (const [key, raw] of Object.entries(storage)) {
    if (!AUTH_KEY.test(key) || raw.length > MAX_SCAN_LENGTH) continue;
    const identity = identityFromValue(parseStoredValue(raw));
    if (identity?.email && (JWT.test(raw.trim()) || readPath(parseStoredValue(raw), 'access_token'))) {
      return finish(identity, 'strong', `localStorage: ${key}`);
    }
  }

  // Weak guesses: a user-ish record with an email, shown but never acted on.
  for (const [key, raw] of Object.entries(storage)) {
    if (!USER_KEY.test(key) || raw.length > MAX_SCAN_LENGTH) continue;
    const parsed = parseStoredValue(raw);
    const identity = identityFromValue(parsed) ?? identityFromValue(readPath(parsed, 'state'));
    if (identity?.email) return finish(identity, 'weak', `localStorage: ${key}`);
  }
  return null;
}

/** Finds out who is signed in, from captured state only (no network requests). */
export function detectIdentity(spec: DetectorSpec, input: DetectionInput): Identity | null {
  switch (spec.kind) {
    case 'none':
      return null;
    case 'auto':
      return detectAuto(input);
    case 'localStorage':
      return detectLocalStorage(input.localStorage ?? {}, spec.keys, spec.fields);
    case 'cookie':
      return detectCookie(input.cookies, spec.names, spec.format, spec.fields);
  }
}

/** Whether detection with this spec is reliable enough to act on its absence ("signed out"). */
export function isSpecificDetector(spec: DetectorSpec): boolean {
  return spec.kind === 'localStorage' || spec.kind === 'cookie';
}

/** Whether the saved account and the detected identity are the same person. */
export function sameIdentity(
  account: Pick<Account, 'identityId' | 'email' | 'name'>,
  identity: Pick<Identity, 'id' | 'email' | 'name'> | null | undefined,
): boolean {
  if (!identity) return false;
  if (account.identityId && identity.id) return account.identityId === identity.id;
  if (account.email && identity.email) return account.email.toLowerCase() === identity.email.toLowerCase();
  if (!account.identityId && !account.email && account.name && identity.name) {
    return account.name.toLowerCase() === identity.name.toLowerCase();
  }
  return false;
}

/** Whether the account has anything detection could compare against. */
export function hasIdentity(account: Pick<Account, 'identityId' | 'email' | 'name'>): boolean {
  return Boolean(account.identityId || account.email || account.name);
}

/** A label for a detected identity: email, else name, else id. */
export function identityLabel(identity: Pick<Identity, 'email' | 'name' | 'id'> | null | undefined): string {
  return identity?.email ?? identity?.name ?? identity?.id ?? '';
}
