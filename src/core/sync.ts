import { appForUrl, hostMatchesDomain } from './domains';
import { hasIdentity, sameIdentity } from './identity';
import { findPreset, isBlockedDomain } from './presets';
import type { Account, AppDef, Workspace } from './types';
import { record } from './util';
import { isId, sanitizeAccount, sanitizeApp, sanitizeWorkspace } from './validate';

/**
 * Optional Chrome Sync of the list: apps, accounts and workspaces travel to the
 * other computers signed in to the same Chrome profile. Sign-ins never do — no
 * snapshot, no cookie, no token is ever written to chrome.storage.sync — and
 * neither does what belongs to one computer (recents, last page, statistics).
 *
 * Each app / account / workspace is one sync item (`sd1:a:<id>`, `sd1:c:<id>`,
 * `sd1:w:<id>`) holding `{ v, t, by, f }`: the value, when and by which
 * installation it was written, and the fields the writer's version sends (so a
 * newer computer keeps what an older one doesn't know about). Removing something
 * on purpose writes a tombstone `{ gone, t, by }`; only a tombstone removes
 * anything elsewhere. An item that just disappears (Chrome Sync cleared, an old
 * tombstone dropped) is forgotten, never removed here, and something that
 * disappears here without being removed on purpose (lost data) is not removed
 * elsewhere — the next sync brings it back.
 *
 * The same thing set up separately on two computers has two ids. When an item
 * arrives for something already here — the same preset or site, the same
 * signed-in user, the same workspace name — it is applied to that thing (an
 * alias) instead of adding a copy. Each computer keeps writing under its own
 * ids; the others map them.
 *
 * `SyncMemo` remembers, per key, the last write this installation made or
 * applied (`t` + `by`), the value as it was synced then (`base`, and its `hash`
 * so unchanged things aren't sent again) and the local thing the key maps to.
 * `base` is the common ground of a three-way merge: a field changed here since
 * then and not by the incoming write keeps its value here.
 */

export const SYNC_PREFIX = 'sd1:';
/** chrome.storage.sync allows 8 KB per item; stay under it. */
export const SYNC_ITEM_MAX_BYTES = 7800;
/**
 * A tombstone is dropped once this computer has known it this long (its own clock: the writer's `t`
 * may be far off). A computer offline for longer brings the thing back to the others — except to the
 * one that removed it, whose removal journal refuses it and sends the tombstone again.
 */
export const TOMBSTONE_TTL_MS = 45 * 24 * 60 * 60 * 1000;

export type SyncKind = 'app' | 'account' | 'workspace';
export type SyncItem = {
  t: number;
  by: string;
  v?: unknown;
  gone?: true;
  /** The fields the writer's version sends for this kind; missing in items written by 1.5 and 1.6. */
  f?: string[];
};
export type MemoEntry = {
  hash: string;
  t: number;
  by: string;
  /** The local thing this key is applied to, when its id differs. */
  local?: string;
  /** Applied with parts missing (members whose account hasn't arrived yet): apply again later. */
  again?: true;
  /** The value as last synced, as it travels from here (missing in memos written before 1.7). */
  base?: Record<string, unknown>;
};
export type SyncMemo = Record<string, MemoEntry>;

const CODES: Record<SyncKind, string> = { app: 'a', account: 'c', workspace: 'w' };
const RANK: Record<SyncKind, number> = { app: 0, account: 1, workspace: 2 };

export function syncKey(kind: SyncKind, id: string): string {
  return `${SYNC_PREFIX}${CODES[kind]}:${id}`;
}

export function parseSyncKey(key: string): { kind: SyncKind; id: string } | null {
  const match = /^sd1:([acw]):([A-Za-z0-9_-]{1,64})$/.exec(key);
  if (!match || !isId(match[2])) return null;
  const kind = (Object.keys(CODES) as SyncKind[]).find((name) => CODES[name] === match[1])!;
  return { kind, id: match[2] };
}

/** The fields of an app as it travels (every field of `AppDef`, plus the `preset` mark of the short form). */
export const APP_SYNC_FIELDS = [
  'id',
  'presetId',
  'name',
  'color',
  'domains',
  'origin',
  'homeUrl',
  'loginUrl',
  'stagingPath',
  'storage',
  'detector',
  'recentPattern',
  'titleSuffix',
  'order',
  'createdAt',
  'preset',
] as const satisfies readonly (keyof AppDef | 'preset')[];

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
  'linkRules',
  'order',
  'createdAt',
] as const satisfies readonly (keyof Account)[];

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
] as const satisfies readonly (keyof Workspace)[];

/** What this version sends, by kind (written into each item as `f`). */
export const SYNC_FIELDS: Record<SyncKind, readonly string[]> = {
  app: APP_SYNC_FIELDS,
  account: ACCOUNT_SYNC_FIELDS,
  workspace: WORKSPACE_SYNC_FIELDS,
};

/**
 * The fields of items written without a field list (`f`): Swapdeck 1.5.0, the first version with sync.
 * 1.6.0 added `linkRules` to accounts without writing `f` either, so a field present in such an item
 * counts as known too. Never change these lists: they describe items already in Chrome Sync.
 */
export const LEGACY_SYNC_FIELDS: Record<SyncKind, readonly string[]> = {
  app: [
    'id',
    'presetId',
    'name',
    'color',
    'domains',
    'origin',
    'homeUrl',
    'loginUrl',
    'stagingPath',
    'storage',
    'detector',
    'recentPattern',
    'titleSuffix',
    'order',
    'createdAt',
    'preset',
  ],
  account: [
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
  ],
  workspace: ['id', 'name', 'color', 'icon', 'emoji', 'note', 'members', 'links', 'order', 'createdAt'],
};

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

/** What an incoming item's writer knows: its own list, or (older versions) the legacy list and what it sent. */
export function writerFields(kind: SyncKind, item: SyncItem): readonly string[] {
  const listed = item.f;
  if (Array.isArray(listed) && listed.length <= 100 && listed.every((field) => typeof field === 'string')) {
    return listed;
  }
  return [...new Set([...LEGACY_SYNC_FIELDS[kind], ...(isObj(item.v) ? Object.keys(item.v) : [])])];
}

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

/** A workspace's members as they travel: those not here yet (another computer's) go along. */
function travellingMembers(workspace: Workspace): Record<string, string> {
  const foreign = workspace.foreignMembers;
  return foreign && Object.keys(foreign).length ? { ...foreign, ...workspace.members } : { ...workspace.members };
}

function entryValue(kind: SyncKind, item: Thing): Record<string, unknown> {
  if (kind === 'app') return appSyncValue(item as AppDef);
  if (kind === 'account') return pick(item, ACCOUNT_SYNC_FIELDS);
  const value = pick(item, WORKSPACE_SYNC_FIELDS);
  value.members = travellingMembers(item as Workspace);
  return value;
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

/**
 * A three-way merge of two travelling values: a field changed here (`mine` differs from `base`) and
 * not by the other computer (`theirs` equals `base`) keeps its value here; any other field takes
 * theirs (when both changed it, the incoming write wins, as before).
 */
export function mergeFields(
  mine: Record<string, unknown>,
  base: Record<string, unknown>,
  theirs: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of new Set([...Object.keys(mine), ...Object.keys(base), ...Object.keys(theirs)])) {
    const changedHere = stableJson(mine[field]) !== stableJson(base[field]);
    const changedThere = stableJson(theirs[field]) !== stableJson(base[field]);
    const value = changedHere && !changedThere ? mine[field] : theirs[field];
    if (value !== undefined) out[field] = value;
  }
  return out;
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
  /** Tombstone key → when this computer first saw it (kept locally, for `drop`). */
  goneSeen: Record<string, number>;
  /**
   * Memo entries given the common ground they lack (written before 1.7): the thing is unchanged since
   * it was synced, so what is here is that value.
   */
  based: SyncMemo;
};

/**
 * What to send: what changed here since it was last synced, and tombstones for
 * what was removed here on purpose (`removed`: the sync keys of things removed
 * by the user here). Something another computer changed meanwhile is left to
 * the next pull. `goneSeen` is when this computer first saw each tombstone.
 */
export function planPush(
  entries: Record<string, unknown>,
  memo: SyncMemo,
  remote: Record<string, SyncItem>,
  removed: ReadonlySet<string>,
  now: number,
  by: string,
  goneSeen: Readonly<Record<string, number>> = {},
): PushPlan {
  const plan: PushPlan = {
    set: {},
    gone: {},
    drop: [],
    tooBig: [],
    written: {},
    forget: [],
    goneSeen: record(),
    based: {},
  };
  for (const [key, value] of Object.entries(entries)) {
    const there = remote[key];
    const known = memo[key];
    if (there && !seen(known, there)) continue;
    const hash = syncHash(value);
    if (there && known?.hash === hash) {
      if (!known.base && isObj(value)) plan.based[key] = { ...known, base: value };
      continue;
    }
    const kind = parseSyncKey(key)?.kind;
    const item: SyncItem = { v: value, t: now, by, ...(kind ? { f: [...SYNC_FIELDS[kind]] } : {}) };
    if (itemBytes(key, item) > SYNC_ITEM_MAX_BYTES) {
      plan.tooBig.push(key);
      continue;
    }
    plan.set[key] = item;
    plan.written[key] = { hash, t: now, by, ...(isObj(value) ? { base: value } : {}) };
  }
  for (const [key, entry] of Object.entries(memo)) {
    const parsed = parseSyncKey(key);
    if (!parsed) {
      plan.forget.push(key);
      continue;
    }
    const target = syncKey(parsed.kind, entry.local ?? parsed.id);
    if (target in entries) {
      const value = entries[target];
      if (!entry.base && isObj(value) && syncHash(value) === entry.hash) plan.based[key] = { ...entry, base: value };
      continue;
    }
    // Gone from here. Removed on purpose: tell the others (even if one of them changed it meanwhile).
    // Lost: forget it, and the next pull brings it back.
    const there = remote[key];
    if (removed.has(target) && there && !there.gone) plan.gone[key] = { gone: true, t: now, by };
    plan.forget.push(key);
  }
  // Removed here on purpose, yet live in Chrome Sync again with no memo of it (a computer offline since
  // its tombstone was dropped sent it back): the removal still stands, so the tombstone goes out again.
  for (const [key, item] of Object.entries(remote)) {
    if (item.gone || key in entries || key in plan.gone || memo[key] || !removed.has(key)) continue;
    if (parseSyncKey(key)) plan.gone[key] = { gone: true, t: now, by };
  }
  for (const [key, item] of Object.entries(remote)) {
    if (!item.gone || key in plan.gone) continue;
    const first = goneSeen[key];
    const since = typeof first === 'number' && Number.isFinite(first) && first <= now ? first : now;
    if (now - since > TOMBSTONE_TTL_MS) plan.drop.push(key);
    else plan.goneSeen[key] = since;
  }
  for (const key of Object.keys(plan.gone)) plan.goneSeen[key] = now;
  return plan;
}

/** Room kept free in chrome.storage.sync, so Chrome's own count never tips a write over the quota. */
export const SYNC_HEADROOM_BYTES = 1024;

const KIND_ORDER: Record<SyncKind, number> = { app: 0, account: 1, workspace: 2 };

/** Bytes an item takes against chrome.storage.sync's quota (key + JSON value, as UTF-8). */
export function storedBytes(key: string, value: unknown): number {
  return new TextEncoder().encode(key + (JSON.stringify(value) ?? '')).length;
}

/**
 * The part of `set` that fits in chrome.storage.sync next to what is already
 * there (`stored`: everything in the sync area), and the keys that don't fit.
 * Apps go first, then accounts, then workspaces (each needs the one before it
 * on the other computers), so a list that outgrows Chrome Sync still sends
 * what fits — one `set()` over the quota would write nothing, every time.
 */
export function fitPush(
  set: Record<string, SyncItem>,
  stored: Record<string, unknown>,
  limits: { quotaBytes: number; maxItems: number },
): { fit: Record<string, SyncItem>; left: string[] } {
  let bytes = 0;
  let items = 0;
  for (const [key, value] of Object.entries(stored)) {
    if (key in set) continue;
    bytes += storedBytes(key, value);
    items++;
  }
  const order = (key: string) => KIND_ORDER[parseSyncKey(key)?.kind ?? 'workspace'];
  const keys = Object.keys(set).sort((a, b) => order(a) - order(b) || (a < b ? -1 : a > b ? 1 : 0));
  const fit: Record<string, SyncItem> = {};
  const left: string[] = [];
  for (const key of keys) {
    const item = set[key]!;
    const size = storedBytes(key, item);
    if (items + 1 > limits.maxItems || bytes + size > limits.quotaBytes - SYNC_HEADROOM_BYTES) {
      left.push(key);
      continue;
    }
    fit[key] = item;
    bytes += size;
    items++;
  }
  return { fit, left };
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
  /** The fields its writer knows (`writerFields`); the others keep their value here. */
  fields: readonly string[];
};

export type PullPlan = {
  /** Writes from other computers (or this one before its memo was lost) not applied yet. */
  upserts: Upsert[];
  /** Things removed elsewhere: the local thing (`id`) and the tombstone's key (settled after the upserts). */
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
      // A tombstone is never "seen": memo entries only describe live writes (both ends forget the key
      // once a removal is handled), and one written in the same millisecond as the last write must count.
      if (known) {
        const id = known.local ?? parsed.id;
        // The same thing here also stands for another key that is still alive (two accounts there
        // matched one here): only that key went away, not the thing.
        if (stillStandsFor(remote, memo, key, parsed.kind, id)) plan.forget.push(key);
        else plan.deletes.push({ kind: parsed.kind, id, key });
      }
      continue;
    }
    if (same && !known?.again) continue;
    plan.upserts.push({
      ...parsed,
      key,
      value: item.v,
      t: item.t,
      by: item.by,
      retry: same,
      fields: writerFields(parsed.kind, item),
    });
  }
  for (const key of Object.keys(memo)) if (!(key in remote)) plan.forget.push(key);
  // Apps first (accounts need their app), then accounts, then workspaces; older writes first.
  plan.upserts.sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.t - b.t);
  plan.deletes.sort((a, b) => RANK[b.kind] - RANK[a.kind]);
  return plan;
}

/**
 * The removals of a pull, settled once its writes are applied (`memo` includes their entries): a
 * thing that another live key now stands for stays, and only the tombstone's key is forgotten.
 */
export function settleDeletes(
  deletes: PullPlan['deletes'],
  remote: Record<string, SyncItem>,
  memo: SyncMemo,
): { deletes: PullPlan['deletes']; forget: string[] } {
  const settled: { deletes: PullPlan['deletes']; forget: string[] } = { deletes: [], forget: [] };
  for (const item of deletes) {
    if (stillStandsFor(remote, memo, item.key, item.kind, item.id)) settled.forget.push(item.key);
    else settled.deletes.push(item);
  }
  return settled;
}

/** Whether another live key in Chrome Sync is applied to the local `id`. */
function stillStandsFor(
  remote: Record<string, SyncItem>,
  memo: SyncMemo,
  gone: string,
  kind: SyncKind,
  id: string,
): boolean {
  return Object.entries(memo).some(([key, entry]) => {
    if (key === gone) return false;
    const parsed = parseSyncKey(key);
    if (parsed?.kind !== kind || (entry.local ?? parsed.id) !== id) return false;
    const item = remote[key];
    return isSyncItem(item) && !item.gone;
  });
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

/**
 * A workspace from another computer, kept with its use count and last use here. Its members that
 * aren't here yet (`foreignMembers`) are set by `applyPull`.
 */
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

/** `incoming` with the fields its writer doesn't know (an older version) taken from the thing here. */
function withLocalUnknown(
  kind: SyncKind,
  incoming: Record<string, unknown>,
  local: Record<string, unknown> | undefined,
  fields: readonly string[],
): Record<string, unknown> {
  if (!local) return incoming;
  const out = { ...incoming };
  for (const field of SYNC_FIELDS[kind]) {
    if (fields.includes(field)) continue;
    if (local[field] === undefined) delete out[field];
    else out[field] = local[field];
  }
  return out;
}

export type PullDraft = { apps: AppDef[]; accounts: Account[]; workspaces: Workspace[] };

export type PullOutcome = {
  /** Memo entries for the keys applied. */
  applied: SyncMemo;
  added: number;
  changed: number;
  /** Writes that wait for a removal of this pull (an app set up again on the same site): pull again. */
  deferred: number;
};

/**
 * Applies other computers' writes to `draft` (inside update()): matching what is
 * already here, translating ids, never breaking the rules for apps (blocked
 * sites, two apps sharing a site). What can't be applied yet (an account whose
 * app hasn't arrived) is left for the next pull. Removals are done by the
 * caller, through the functions that also drop saved sign-ins; `removing` are
 * the things this pull's tombstones remove: nothing new is matched to them.
 * `removed` is the removal journal: a write for something removed here on
 * purpose is refused (the removal wins).
 */
export function applyPull(
  draft: PullDraft,
  upserts: readonly Upsert[],
  memo: SyncMemo,
  removed: ReadonlySet<string> = new Set(),
  removing: readonly { kind: SyncKind; id: string }[] = [],
): PullOutcome {
  const outcome: PullOutcome = { applied: {}, added: 0, changed: 0, deferred: 0 };
  const lists = { app: draft.apps, account: draft.accounts, workspace: draft.workspaces };
  const find = (kind: SyncKind, id: string): Thing | undefined =>
    (lists[kind] as Thing[]).find((item) => item.id === id);
  const going = new Set(removing.map((item) => syncKey(item.kind, item.id)));
  /** Removed by this pull's tombstones (once its writes are in): never the match for something new. */
  const isGoing = (kind: SyncKind, id: string) => going.has(syncKey(kind, id));
  // key → local id, from the memo and from this pull.
  const bound = record<string>();
  /** key → the computer that wrote it. */
  const writer = record<string>();
  for (const [key, entry] of Object.entries(memo)) {
    const parsed = parseSyncKey(key);
    if (parsed) {
      bound[key] = entry.local ?? parsed.id;
      writer[key] = entry.by;
    }
  }
  /** The local id another computer's id stands for here. */
  const resolve = (kind: SyncKind, id: unknown): string | null => {
    if (!isId(id)) return null;
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
  /** Already standing in for another thing written by the same computer: there, they are two. */
  const takenBy = (kind: SyncKind, id: string, by: string) =>
    Object.entries(bound).some(([key, local]) => {
      const parsed = parseSyncKey(key);
      return local === id && parsed?.kind === kind && parsed.id !== id && writer[key] === by;
    });
  /** Seen before and changed here since: the change here wins. */
  const changedHere = (upsert: Upsert, target: string | null) => {
    const item = target ? find(upsert.kind, target) : undefined;
    return !item || syncHash(entryValue(upsert.kind, item)) !== memo[upsert.key]?.hash;
  };
  /** A key (or the thing it maps to) removed here on purpose: the removal wins (its tombstone follows). */
  const removedHere = (kind: SyncKind, key: string) => {
    if (removed.has(key)) return true;
    const local = bound[key];
    return local !== undefined && !find(kind, local) && removed.has(syncKey(kind, local));
  };
  /** The value last synced for this key, when it is about the same thing here (a three-way merge's base). */
  const baseFor = (upsert: Upsert, target: string) => {
    const entry = memo[upsert.key];
    return entry?.base && (entry.local ?? upsert.id) === target ? entry.base : undefined;
  };
  /**
   * Members in another computer's ids: those whose app and account are here (translated), and those
   * that aren't yet (`foreign`, kept as they are so they travel back). Members whose app or account
   * was removed here on purpose are dropped.
   */
  const splitMembers = (raw: unknown) => {
    const members = record<string>();
    const foreign = record<string>();
    for (const [appKey, accountKey] of Object.entries(isObj(raw) ? raw : {})) {
      if (!isId(appKey) || !isId(accountKey)) continue;
      const appId = resolve('app', appKey);
      const accountId = resolve('account', accountKey);
      if (appId && accountId && draft.accounts.some((item) => item.id === accountId && item.appId === appId)) {
        members[appId] = accountId;
      } else if (
        !removedHere('app', syncKey('app', appKey)) &&
        !removedHere('account', syncKey('account', accountKey))
      ) {
        foreign[appKey] = accountKey;
      }
    }
    // A member set for the same app here supersedes one waiting for it.
    for (const appKey of Object.keys(foreign)) {
      const appId = resolve('app', appKey) ?? appKey;
      if (appId in members) delete foreign[appKey];
    }
    return { members, foreign };
  };
  /** A workspace from `value` (in another computer's ids), kept with what this computer knows. */
  const buildWorkspace = (local: Workspace | undefined, value: Record<string, unknown>, id: string) => {
    const { members, foreign } = splitMembers(value.members);
    const workspace = sanitizeWorkspace(mergeWorkspace(local, { ...value, id, members }));
    if (!workspace) return null;
    if (Object.keys(foreign).length) workspace.foreignMembers = foreign;
    else delete workspace.foreignMembers;
    return workspace;
  };
  const done: { upsert: Upsert; id: string; base?: Record<string, unknown> }[] = [];
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
    if (!isObj(value) || removedHere(upsert.kind, upsert.key)) continue;
    let target = resolve(upsert.kind, upsert.id);
    if (upsert.retry && changedHere(upsert, target)) continue;
    /** Set when the merge kept something changed here: the incoming value is the new common ground. */
    let base: Record<string, unknown> | undefined;

    if (upsert.kind === 'app') {
      const here = target ? (find('app', target) as AppDef | undefined) : undefined;
      const incoming = withLocalUnknown('app', value, here && entryValue('app', here), upsert.fields);
      let app = appFromSync(incoming, target ?? upsert.id);
      if (!app) continue;
      if (!target) {
        const fresh = app;
        const match = draft.apps.find(
          (item) =>
            !isGoing('app', item.id) &&
            ((fresh.presetId && item.presetId === fresh.presetId) ||
              item.origin === fresh.origin ||
              overlaps(item, fresh)),
        );
        if (match) {
          target = match.id;
          app = { ...app, id: match.id };
        }
      }
      const local = target ? (find('app', target) as AppDef | undefined) : undefined;
      const common = local && baseFor(upsert, local.id);
      if (local && common) {
        const theirs = appSyncValue(app);
        const merged = mergeFields(appSyncValue(local), common, theirs);
        const kept = stableJson(merged) !== stableJson(theirs) ? appFromSync(merged, local.id) : null;
        if (kept) {
          app = kept;
          base = theirs;
        }
      }
      const final = app;
      if (final.domains.some(isBlockedDomain) || !appForUrl([final], final.origin)) continue;
      const clash = draft.apps.filter((item) => item.id !== final.id && overlaps(item, final));
      if (clash.length) {
        // Only in the way of something this pull removes: taken in a second round, once it is gone.
        if (clash.every((item) => isGoing('app', item.id))) outcome.deferred++;
        continue;
      }
      place(draft.apps, final);
      bound[upsert.key] = final.id;
      writer[upsert.key] = upsert.by;
      done.push({ upsert, id: final.id, base });
    } else if (upsert.kind === 'account') {
      const appId = resolve('app', value.appId);
      if (!appId) continue;
      if (!target) {
        const siblings = draft.accounts.filter((item) => item.appId === appId && !isGoing('account', item.id));
        const identity = { id: text(value.identityId), email: text(value.email) };
        // Same person: prefer an account nothing stands for yet, and never fold two accounts of
        // one computer into one here (removing either there would remove both here).
        const same = identity.id || identity.email ? siblings.filter((item) => sameIdentity(item, identity)) : [];
        const strong =
          same.find((item) => !aliased('account', item.id)) ??
          same.find((item) => !takenBy('account', item.id, upsert.by));
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
      const incoming = withLocalUnknown('account', value, local && entryValue('account', local), upsert.fields);
      let account = sanitizeAccount(mergeAccount(local, { ...incoming, id: target ?? upsert.id, appId }));
      if (!account) continue;
      const common = local && baseFor(upsert, local.id);
      if (local && common) {
        const theirs = entryValue('account', account);
        const merged = mergeFields(entryValue('account', local), common, theirs);
        const kept = stableJson(merged) !== stableJson(theirs) ? sanitizeAccount(mergeAccount(local, merged)) : null;
        if (kept) {
          account = kept;
          base = theirs;
        }
      }
      place(draft.accounts, account);
      bound[upsert.key] = account.id;
      writer[upsert.key] = upsert.by;
      done.push({ upsert, id: account.id, base });
    } else {
      if (!target) {
        const name = fold(value.name);
        target =
          draft.workspaces.find(
            (item) => fold(item.name) === name && !aliased('workspace', item.id) && !isGoing('workspace', item.id),
          )?.id ?? null;
      }
      const local = target ? draft.workspaces.find((item) => item.id === target) : undefined;
      const incoming = withLocalUnknown('workspace', value, local && entryValue('workspace', local), upsert.fields);
      let workspace = buildWorkspace(local, incoming, target ?? upsert.id);
      if (!workspace) continue;
      const common = local && baseFor(upsert, local.id);
      if (local && common) {
        const theirs = entryValue('workspace', workspace);
        const merged = mergeFields(entryValue('workspace', local), common, theirs);
        const kept = stableJson(merged) !== stableJson(theirs) ? buildWorkspace(local, merged, local.id) : null;
        if (kept) {
          workspace = kept;
          base = theirs;
        }
      }
      place(draft.workspaces, workspace);
      bound[upsert.key] = workspace.id;
      writer[upsert.key] = upsert.by;
      done.push({ upsert, id: workspace.id, base });
    }
  }

  // Members that were waiting for their app or account: those that arrived become real members.
  for (const workspace of draft.workspaces) {
    if (!workspace.foreignMembers) continue;
    const { members, foreign } = splitMembers(workspace.foreignMembers);
    if (!Object.keys(members).length && Object.keys(foreign).length === Object.keys(workspace.foreignMembers).length) {
      continue;
    }
    const next = record<string>();
    Object.assign(next, members, workspace.members);
    workspace.members = next;
    for (const appKey of Object.keys(foreign)) if ((resolve('app', appKey) ?? appKey) in next) delete foreign[appKey];
    if (Object.keys(foreign).length) workspace.foreignMembers = foreign;
    else delete workspace.foreignMembers;
  }

  // What each key's thing looks like now (or, when the merge kept changes made here, the incoming
  // value: then what is here differs and is sent), so nothing is sent straight back.
  for (const { upsert, id, base } of done) {
    const item = find(upsert.kind, id);
    if (!item) continue;
    const value = base ?? entryValue(upsert.kind, item);
    const entry: MemoEntry = { hash: syncHash(value), t: upsert.t, by: upsert.by, base: value };
    if (id !== upsert.id) entry.local = id;
    if (upsert.kind === 'workspace' && (item as Workspace).foreignMembers) entry.again = true;
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
    (value.local === undefined || isId(value.local)) &&
    (value.again === undefined || value.again === true) &&
    (value.base === undefined || isObj(value.base))
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
  /** Things that didn't fit in what is left of Chrome Sync's space (sent once there is room). */
  full?: number;
  error?: 'quota' | 'unknown';
};

export function isSyncStatus(value: unknown): value is SyncStatus {
  if (!isObj(value)) return false;
  return typeof value.ok === 'boolean' && typeof value.at === 'number' && typeof value.items === 'number';
}
