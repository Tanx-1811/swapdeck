import { appForUrl, hostMatchesDomain } from './domains';
import { hasIdentity, sameIdentity } from './identity';
import { findPreset, isBlockedDomain } from './presets';
import type { Account, AppDef, Workspace } from './types';
import { sanitizeAccount, sanitizeApp, sanitizeWorkspace } from './validate';

/**
 * Optional Chrome Sync of the list: apps, accounts and workspaces travel to the
 * other computers signed in to the same Chrome profile. Sign-ins never do — no
 * snapshot, no cookie, no token is ever written to chrome.storage.sync — and
 * neither does what belongs to one computer (recents, last page, statistics).
 *
 * Each app / account / workspace is one sync item (`sd1:a:<id>`, `sd1:c:<id>`,
 * `sd1:w:<id>`) holding `{ v, t, by }`: the value, when and by which
 * installation it was written. Removing something on purpose writes a
 * tombstone `{ gone, t, by }`; only a tombstone removes anything elsewhere. An
 * item that just disappears (Chrome Sync cleared, an old tombstone dropped) is
 * forgotten, never removed here, and something that disappears here without
 * being removed on purpose (lost data) is not removed elsewhere — the next sync
 * brings it back.
 *
 * The same thing set up separately on two computers has two ids. When an item
 * arrives for something already here — the same preset or site, the same
 * signed-in user, the same workspace name — it is applied to that thing (an
 * alias) instead of adding a copy. Each computer keeps writing under its own
 * ids; the others map them.
 *
 * `SyncMemo` remembers, per key, the last write this installation made or
 * applied (`t` + `by`), what the thing looked like then (`hash`, so unchanged
 * things aren't sent again) and the local thing the key maps to.
 */

export const SYNC_PREFIX = 'sd1:';
/** chrome.storage.sync allows 8 KB per item; stay under it. */
export const SYNC_ITEM_MAX_BYTES = 7800;
/** Tombstones are dropped after this long (a computer offline for longer brings the thing back). */
export const TOMBSTONE_TTL_MS = 45 * 24 * 60 * 60 * 1000;

export type SyncKind = 'app' | 'account' | 'workspace';
export type SyncItem = { t: number; by: string; v?: unknown; gone?: true };
export type MemoEntry = {
  hash: string;
  t: number;
  by: string;
  /** The local thing this key is applied to, when its id differs. */
  local?: string;
  /** Applied with parts missing (members whose account hasn't arrived yet): apply again later. */
  again?: true;
};
export type SyncMemo = Record<string, MemoEntry>;

const CODES: Record<SyncKind, string> = { app: 'a', account: 'c', workspace: 'w' };
const RANK: Record<SyncKind, number> = { app: 0, account: 1, workspace: 2 };

export function syncKey(kind: SyncKind, id: string): string {
  return `${SYNC_PREFIX}${CODES[kind]}:${id}`;
}

export function parseSyncKey(key: string): { kind: SyncKind; id: string } | null {
  const match = /^sd1:([acw]):([A-Za-z0-9_-]{1,64})$/.exec(key);
  if (!match) return null;
  const kind = (Object.keys(CODES) as SyncKind[]).find((name) => CODES[name] === match[1])!;
  return { kind, id: match[2]! };
}

/** The fields of an account that travel (never its sign-in or what belongs to one computer). */
export const ACCOUNT_SYNC_FIELDS = [
  'id',
  'appId',
  'label',
  'color',
  'icon',
  'emoji',
  'note',
  'email',
  'name',
  'identityId',
  'homeUrl',
  'important',
  'pins',
  'order',
  'createdAt',
] as const;

export const WORKSPACE_SYNC_FIELDS = [
  'id',
  'name',
  'color',
  'icon',
  'emoji',
  'note',
  'members',
  'links',
  'order',
  'createdAt',
] as const;

/** What a built-in preset defines: an app that still matches its preset travels without it. */
const PRESET_FIELDS = [
  'domains',
  'origin',
  'homeUrl',
  'loginUrl',
  'stagingPath',
  'storage',
  'detector',
  'recentPattern',
  'titleSuffix',
] as const;

function pick(value: object, fields: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const item = (value as Record<string, unknown>)[field];
    if (item !== undefined) out[field] = item;
  }
  return out;
}

const isObj = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);
const fold = (value: unknown): string => (typeof value === 'string' ? value.trim().toLowerCase() : '');

/** The app a built-in preset makes, as it would be saved. */
function fromPreset(
  presetId: string | undefined,
  base: Pick<AppDef, 'id' | 'name' | 'color' | 'order' | 'createdAt'>,
): AppDef | null {
  const preset = findPreset(presetId);
  return preset ? sanitizeApp({ ...preset, ...base, presetId: preset.id }) : null;
}

/** An app as it travels: a preset app nobody changed is just its preset id. */
export function appSyncValue(app: AppDef): Record<string, unknown> {
  const { id, name, color, order, createdAt } = app;
  const built = fromPreset(app.presetId, { id, name, color, order, createdAt });
  if (built && stableJson(pick(app, PRESET_FIELDS)) === stableJson(pick(built, PRESET_FIELDS))) {
    return { ...pick(app, ['id', 'presetId', 'name', 'color', 'order', 'createdAt']), preset: true };
  }
  return { ...app };
}

/** An app from another computer, or null when it can't be made here (e.g. a preset this version lacks). */
export function appFromSync(value: Record<string, unknown>, id: string): AppDef | null {
  if (value.preset !== true) return sanitizeApp({ ...value, id });
  const preset = findPreset(text(value.presetId));
  if (!preset) return null;
  return fromPreset(preset.id, {
    id,
    name: text(value.name) ?? preset.name,
    color: text(value.color) ?? preset.color,
    order: typeof value.order === 'number' ? value.order : 0,
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : Date.now(),
  });
}

type Thing = AppDef | Account | Workspace;

function entryValue(kind: SyncKind, item: Thing): unknown {
  if (kind === 'app') return appSyncValue(item as AppDef);
  return pick(item, kind === 'account' ? ACCOUNT_SYNC_FIELDS : WORKSPACE_SYNC_FIELDS);
}

/** Everything that travels, by sync key. */
export function syncEntries(state: {
  apps: readonly AppDef[];
  accounts: readonly Account[];
  workspaces: readonly Workspace[];
}): Record<string, unknown> {
  const entries: Record<string, unknown> = {};
  for (const app of state.apps) entries[syncKey('app', app.id)] = entryValue('app', app);
  for (const account of state.accounts) entries[syncKey('account', account.id)] = entryValue('account', account);
  for (const workspace of state.workspaces) {
    entries[syncKey('workspace', workspace.id)] = entryValue('workspace', workspace);
  }
  return entries;
}

/** JSON with sorted keys: the same value always gives the same text. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .filter((key) => object[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** A short fingerprint of a value (FNV-1a over its stable JSON). */
export function syncHash(value: unknown): string {
  let hash = 0x811c9dc5;
  const json = stableJson(value);
  for (let index = 0; index < json.length; index++) {
    hash ^= json.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function isSyncItem(value: unknown): value is SyncItem {
  if (!isObj(value)) return false;
  if (typeof value.t !== 'number' || !Number.isFinite(value.t) || typeof value.by !== 'string') return false;
  return value.gone === true || 'v' in value;
}

/** Whether `item` is the write the memo already knows (made or applied here). */
function seen(entry: MemoEntry | undefined, item: SyncItem): boolean {
  return entry !== undefined && entry.t === item.t && entry.by === item.by;
}

function itemBytes(key: string, item: SyncItem): number {
  return new TextEncoder().encode(key + JSON.stringify(item)).length;
}

// --- Sending -----------------------------------------------------------------

export type PushPlan = {
  /** What changed here. */
  set: Record<string, SyncItem>;
  /** Tombstones for what was removed here on purpose. */
  gone: Record<string, SyncItem>;
  /** Old tombstones to drop. */
  drop: string[];
  /** Too big for one sync item (kept on this computer only). */
  tooBig: string[];
  /** Memo entries once `set` is written. */
  written: SyncMemo;
  /** Memo keys to forget once `gone` is written. */
  forget: string[];
};

/**
 * What to send: what changed here since it was last synced, and tombstones for
 * what was removed here on purpose (`removed`: the sync keys of things removed
 * by the user here). Something another computer changed meanwhile is left to
 * the next pull.
 */
export function planPush(
  entries: Record<string, unknown>,
  memo: SyncMemo,
  remote: Record<string, SyncItem>,
  removed: ReadonlySet<string>,
  now: number,
  by: string,
): PushPlan {
  const plan: PushPlan = { set: {}, gone: {}, drop: [], tooBig: [], written: {}, forget: [] };
  for (const [key, value] of Object.entries(entries)) {
    const there = remote[key];
    const known = memo[key];
    if (there && !seen(known, there)) continue;
    const hash = syncHash(value);
    if (there && known?.hash === hash) continue;
    const item: SyncItem = { v: value, t: now, by };
    if (itemBytes(key, item) > SYNC_ITEM_MAX_BYTES) {
      plan.tooBig.push(key);
      continue;
    }
    plan.set[key] = item;
    plan.written[key] = { hash, t: now, by };
  }
  for (const [key, entry] of Object.entries(memo)) {
    const parsed = parseSyncKey(key);
    if (!parsed) {
      plan.forget.push(key);
      continue;
    }
    const target = syncKey(parsed.kind, entry.local ?? parsed.id);
    if (target in entries) continue;
    // Gone from here. Removed on purpose: tell the others (even if one of them changed it meanwhile).
    // Lost: forget it, and the next pull brings it back.
    const there = remote[key];
    if (removed.has(target) && there && !there.gone) plan.gone[key] = { gone: true, t: now, by };
    plan.forget.push(key);
  }
  for (const [key, item] of Object.entries(remote)) {
    if (item.gone && now - item.t > TOMBSTONE_TTL_MS) plan.drop.push(key);
  }
  return plan;
}

// --- Receiving ---------------------------------------------------------------

export type Upsert = {
  kind: SyncKind;
  id: string;
  key: string;
  value: unknown;
  t: number;
  by: string;
  /** Seen before but applied with parts missing: only if unchanged here since. */
  retry: boolean;
};

export type PullPlan = {
  /** Writes from other computers (or this one before its memo was lost) not applied yet. */
  upserts: Upsert[];
  /** Things removed elsewhere: the local thing (`id`) and the tombstone's key. */
  deletes: { kind: SyncKind; id: string; key: string }[];
  /** Keys gone from Chrome Sync altogether: forgotten, nothing removed. */
  forget: string[];
};

/** What to take from Chrome Sync. */
export function planPull(remote: Record<string, SyncItem>, memo: SyncMemo): PullPlan {
  const plan: PullPlan = { upserts: [], deletes: [], forget: [] };
  for (const [key, item] of Object.entries(remote)) {
    const parsed = parseSyncKey(key);
    if (!parsed || !isSyncItem(item)) continue;
    const known = memo[key];
    const same = seen(known, item);
    if (item.gone) {
      if (known && !same) plan.deletes.push({ kind: parsed.kind, id: known.local ?? parsed.id, key });
      continue;
    }
    if (same && !known?.again) continue;
    plan.upserts.push({ ...parsed, key, value: item.v, t: item.t, by: item.by, retry: same });
  }
  for (const key of Object.keys(memo)) if (!(key in remote)) plan.forget.push(key);
  // Apps first (accounts need their app), then accounts, then workspaces; older writes first.
  plan.upserts.sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.t - b.t);
  plan.deletes.sort((a, b) => RANK[b.kind] - RANK[a.kind]);
  return plan;
}

function overlaps(a: Pick<AppDef, 'domains'>, b: Pick<AppDef, 'domains'>): boolean {
  return a.domains.some((x) => b.domains.some((y) => hostMatchesDomain(x, y) || hostMatchesDomain(y, x)));
}

/** An account from another computer, kept with what this computer knows about it. */
export function mergeAccount(local: Account | undefined, incoming: Record<string, unknown>): Record<string, unknown> {
  const travelling = pick(incoming, ACCOUNT_SYNC_FIELDS);
  if (!local) return { pins: [], recents: [], switchCount: 0, ...travelling };
  const merged: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(local)) {
    if (!(ACCOUNT_SYNC_FIELDS as readonly string[]).includes(field)) merged[field] = value;
  }
  Object.assign(merged, travelling);
  // A sign-in saved here says who the account is here.
  if (local.capturedAt && hasIdentity(local)) {
    for (const field of ['identityId', 'email', 'name'] as const) {
      if (local[field]) merged[field] = local[field];
      else delete merged[field];
    }
  }
  return merged;
}

/** A workspace from another computer, kept with its use count and last use here. */
export function mergeWorkspace(
  local: Workspace | undefined,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const travelling = pick(incoming, WORKSPACE_SYNC_FIELDS);
  if (!local) return { switchCount: 0, ...travelling };
  return {
    ...travelling,
    switchCount: local.switchCount,
    ...(local.lastUsedAt ? { lastUsedAt: local.lastUsedAt } : {}),
  };
}

export type PullDraft = { apps: AppDef[]; accounts: Account[]; workspaces: Workspace[] };

export type PullOutcome = {
  /** Memo entries for the keys applied. */
  applied: SyncMemo;
  added: number;
  changed: number;
};

/**
 * Applies other computers' writes to `draft` (inside update()): matching what is
 * already here, translating ids, never breaking the rules for apps (blocked
 * sites, two apps sharing a site). What can't be applied yet (an account whose
 * app hasn't arrived) is left for the next pull. Removals are done by the
 * caller, through the functions that also drop saved sign-ins.
 */
export function applyPull(
  draft: PullDraft,
  upserts: readonly Upsert[],
  memo: SyncMemo,
  removed: ReadonlySet<string> = new Set(),
): PullOutcome {
  const outcome: PullOutcome = { applied: {}, added: 0, changed: 0 };
  const lists = { app: draft.apps, account: draft.accounts, workspace: draft.workspaces };
  const find = (kind: SyncKind, id: string): Thing | undefined =>
    (lists[kind] as Thing[]).find((item) => item.id === id);
  // key → local id, from the memo and from this pull.
  const bound: Record<string, string> = {};
  for (const [key, entry] of Object.entries(memo)) {
    const parsed = parseSyncKey(key);
    if (parsed) bound[key] = entry.local ?? parsed.id;
  }
  /** The local id another computer's id stands for here. */
  const resolve = (kind: SyncKind, id: unknown): string | null => {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
    const local = bound[syncKey(kind, id)];
    if (local && find(kind, local)) return local;
    return find(kind, id) ? id : null;
  };
  /** Already standing in for another id (a match by name alone is made once). */
  const aliased = (kind: SyncKind, id: string) =>
    Object.entries(bound).some(([key, local]) => {
      const parsed = parseSyncKey(key);
      return local === id && parsed?.kind === kind && parsed.id !== id;
    });
  /** Seen before and changed here since: the change here wins. */
  const changedHere = (upsert: Upsert, target: string | null) => {
    const item = target ? find(upsert.kind, target) : undefined;
    return !item || syncHash(entryValue(upsert.kind, item)) !== memo[upsert.key]?.hash;
  };
  /** Mapped to something removed here on purpose: the removal wins (its tombstone follows). */
  const removedHere = (upsert: Upsert) => {
    const local = bound[upsert.key];
    return local !== undefined && !find(upsert.kind, local) && removed.has(syncKey(upsert.kind, local));
  };
  const done: { upsert: Upsert; id: string; again: boolean }[] = [];
  const place = <T extends { id: string }>(list: T[], item: T) => {
    const index = list.findIndex((existing) => existing.id === item.id);
    if (index === -1) {
      list.push(item);
      outcome.added++;
    } else {
      list[index] = item;
      outcome.changed++;
    }
  };

  for (const upsert of upserts) {
    const value = upsert.value;
    if (!isObj(value) || removedHere(upsert)) continue;
    let target = resolve(upsert.kind, upsert.id);
    if (upsert.retry && changedHere(upsert, target)) continue;

    if (upsert.kind === 'app') {
      let app = appFromSync(value, target ?? upsert.id);
      if (!app) continue;
      if (!target) {
        const incoming = app;
        const match = draft.apps.find(
          (item) =>
            (incoming.presetId && item.presetId === incoming.presetId) ||
            item.origin === incoming.origin ||
            overlaps(item, incoming),
        );
        if (match) {
          target = match.id;
          app = { ...app, id: match.id };
        }
      }
      const final = app;
      if (final.domains.some(isBlockedDomain) || !appForUrl([final], final.origin)) continue;
      if (draft.apps.some((item) => item.id !== final.id && overlaps(item, final))) continue;
      place(draft.apps, final);
      bound[upsert.key] = final.id;
      done.push({ upsert, id: final.id, again: false });
    } else if (upsert.kind === 'account') {
      const appId = resolve('app', value.appId);
      if (!appId) continue;
      if (!target) {
        const siblings = draft.accounts.filter((item) => item.appId === appId);
        const identity = { id: text(value.identityId), email: text(value.email) };
        const strong =
          identity.id || identity.email ? siblings.find((item) => sameIdentity(item, identity)) : undefined;
        const weak = strong
          ? undefined
          : siblings.find(
              (item) => !hasIdentity(item) && fold(item.label) === fold(value.label) && !aliased('account', item.id),
            );
        target = (strong ?? weak)?.id ?? null;
      }
      const local = target ? draft.accounts.find((item) => item.id === target) : undefined;
      // Never move an account (and its saved sign-in) to another app.
      if (local && local.appId !== appId) continue;
      const account = sanitizeAccount(mergeAccount(local, { ...value, id: target ?? upsert.id, appId }));
      if (!account) continue;
      place(draft.accounts, account);
      bound[upsert.key] = account.id;
      done.push({ upsert, id: account.id, again: false });
    } else {
      let missing = false;
      const members: Record<string, string> = {};
      for (const [appKey, accountKey] of Object.entries(isObj(value.members) ? value.members : {})) {
        const appId = resolve('app', appKey);
        const accountId = resolve('account', accountKey);
        if (appId && accountId && draft.accounts.some((item) => item.id === accountId && item.appId === appId)) {
          members[appId] = accountId;
        } else missing = true;
      }
      if (!target) {
        const name = fold(value.name);
        target =
          draft.workspaces.find((item) => fold(item.name) === name && !aliased('workspace', item.id))?.id ?? null;
      }
      const local = target ? draft.workspaces.find((item) => item.id === target) : undefined;
      const workspace = sanitizeWorkspace(mergeWorkspace(local, { ...value, id: target ?? upsert.id, members }));
      if (!workspace) continue;
      place(draft.workspaces, workspace);
      bound[upsert.key] = workspace.id;
      done.push({ upsert, id: workspace.id, again: missing });
    }
  }

  // What each key's thing looks like now, so it isn't sent straight back.
  for (const { upsert, id, again } of done) {
    const item = find(upsert.kind, id);
    if (!item) continue;
    const entry: MemoEntry = { hash: syncHash(entryValue(upsert.kind, item)), t: upsert.t, by: upsert.by };
    if (id !== upsert.id) entry.local = id;
    if (again) entry.again = true;
    outcome.applied[upsert.key] = entry;
  }
  return outcome;
}

export function isMemoEntry(value: unknown): value is MemoEntry {
  if (!isObj(value)) return false;
  return (
    typeof value.hash === 'string' &&
    typeof value.t === 'number' &&
    typeof value.by === 'string' &&
    (value.local === undefined || (typeof value.local === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value.local))) &&
    (value.again === undefined || value.again === true)
  );
}

/** How the last sync went (session storage, shown in Settings). */
export type SyncStatus = {
  ok: boolean;
  at: number;
  /** Things kept in sync. */
  items: number;
  /** Things too big for one sync item (kept here only). */
  tooBig: number;
  error?: 'quota' | 'unknown';
};

export function isSyncStatus(value: unknown): value is SyncStatus {
  if (!isObj(value)) return false;
  return typeof value.ok === 'boolean' && typeof value.at === 'number' && typeof value.items === 'number';
}
