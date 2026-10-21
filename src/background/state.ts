import { CryptoError, seal, unseal } from '../core/crypto';
import type { Account, HistoryEntry, SessionStats, Snapshot, StoredSnapshot } from '../core/types';
import { jsonSize, newId } from '../core/util';
import { sanitizeSnapshot, sanitizeStoredSnapshot, sanitizeVault } from '../core/validate';
import { SwapdeckError } from '../shared/protocol';
import { KEYS, prevSnapKey, readState, SESSION_KEYS, snapKey, type State } from '../shared/store';

/*
 * The service worker is the only writer. Every change goes through one queue,
 * so concurrent requests (a switch, an edit in the manager, a page load) never
 * overwrite each other's read-modify-write.
 */

let queue: Promise<unknown> = Promise.resolve();

export function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

const STATE_FIELDS: [keyof State, string][] = [
  ['apps', KEYS.apps],
  ['accounts', KEYS.accounts],
  ['active', KEYS.active],
  ['settings', KEYS.settings],
  ['history', KEYS.history],
  ['vault', KEYS.vault],
  ['workspaces', KEYS.workspaces],
];

/** Applies a change to the state and writes back only what changed. */
export function update<T>(mutate: (draft: State) => T | Promise<T>): Promise<T> {
  return exclusive(async () => {
    const draft = await readState();
    const before = new Map(STATE_FIELDS.map(([field]) => [field, JSON.stringify(draft[field])]));
    const result = await mutate(draft);
    const changes: Record<string, unknown> = {};
    const removals: string[] = [];
    for (const [field, key] of STATE_FIELDS) {
      if (JSON.stringify(draft[field]) === before.get(field)) continue;
      if (draft[field] === null) removals.push(key);
      else changes[key] = draft[field];
    }
    if (Object.keys(changes).length) await chrome.storage.local.set(changes);
    if (removals.length) await chrome.storage.local.remove(removals);
    return result;
  });
}

const HISTORY_LIMIT = 200;

export function pushHistory(draft: State, entry: Omit<HistoryEntry, 'id' | 'at'>): void {
  draft.history = [{ id: newId('h'), at: Date.now(), ...entry }, ...draft.history].slice(0, HISTORY_LIMIT);
}

// --- Vault key (memory only) -------------------------------------------------

export async function getPrivateKey(): Promise<string | null> {
  const raw = await chrome.storage.session.get(SESSION_KEYS.privateKey);
  const value = raw[SESSION_KEYS.privateKey];
  return typeof value === 'string' ? value : null;
}

export async function setPrivateKey(key: string | null): Promise<void> {
  if (key) await chrome.storage.session.set({ [SESSION_KEYS.privateKey]: key });
  else await chrome.storage.session.remove(SESSION_KEYS.privateKey);
}

// --- Saved sessions ----------------------------------------------------------

export function sessionStats(snapshot: Snapshot): SessionStats {
  return {
    cookies: snapshot.cookies.length,
    storageKeys:
      Object.keys(snapshot.storage.localStorage ?? {}).length +
      Object.keys(snapshot.storage.sessionStorage ?? {}).length,
    databases: snapshot.storage.indexedDB?.length ?? 0,
    bytes: jsonSize(snapshot),
  };
}

/** Wraps a snapshot for storage: sealed with the vault's public key when a vault exists. */
export async function packSnapshot(snapshot: Snapshot, publicKey: string | null): Promise<StoredSnapshot> {
  return publicKey ? { v: 1, sealed: await seal(snapshot, publicKey) } : { v: 1, plain: snapshot };
}

export async function unpackSnapshot(stored: StoredSnapshot): Promise<Snapshot> {
  if ('plain' in stored) return stored.plain;
  const key = await getPrivateKey();
  if (!key) throw new SwapdeckError('LOCKED');
  try {
    const snapshot = sanitizeSnapshot(await unseal<unknown>(stored.sealed, key));
    if (!snapshot) throw new SwapdeckError('CORRUPT');
    return snapshot;
  } catch (error) {
    if (error instanceof CryptoError || error instanceof SwapdeckError) throw new SwapdeckError('CORRUPT');
    throw error;
  }
}

export async function readStoredSnapshot(accountId: string, previous = false): Promise<StoredSnapshot | null> {
  const key = previous ? prevSnapKey(accountId) : snapKey(accountId);
  const raw = await chrome.storage.local.get(key);
  return sanitizeStoredSnapshot(raw[key]);
}

export async function loadSnapshot(accountId: string, previous = false): Promise<Snapshot> {
  const stored = await readStoredSnapshot(accountId, previous);
  if (!stored) throw new SwapdeckError('NO_SESSION');
  return unpackSnapshot(stored);
}

async function vaultPublicKey(): Promise<string | null> {
  const raw = await chrome.storage.local.get(KEYS.vault);
  return sanitizeVault(raw[KEYS.vault])?.publicKey ?? null;
}

/**
 * Saves a session for an account, keeping the one it replaces as "previous"
 * (a safety net if a signed-out or wrong session was saved by mistake).
 * The vault is checked inside the queue, so a session saved while the vault is
 * being created is still sealed. Never call inside update() or exclusive().
 */
export async function storeSnapshot(
  accountId: string,
  snapshot: Snapshot,
  options: { keepPrevious?: boolean } = {},
): Promise<void> {
  const keepPrevious = options.keepPrevious ?? true;
  await exclusive(async () => {
    const packed = await packSnapshot(snapshot, await vaultPublicKey());
    const current = await chrome.storage.local.get(snapKey(accountId));
    const changes: Record<string, unknown> = { [snapKey(accountId)]: packed };
    if (keepPrevious && current[snapKey(accountId)]) changes[prevSnapKey(accountId)] = current[snapKey(accountId)];
    await chrome.storage.local.set(changes);
  });
}

export async function removeSnapshots(accountIds: readonly string[]): Promise<void> {
  await chrome.storage.local.remove(accountIds.flatMap((id) => [snapKey(id), prevSnapKey(id)]));
}

/** Every stored snapshot key (current and previous), for vault and backup operations. */
export async function allSnapshotKeys(): Promise<string[]> {
  const all = await chrome.storage.local.get(null);
  return Object.keys(all).filter((key) => key.startsWith('sd:snap:') || key.startsWith('sd:prev:'));
}

export function findAccount(state: State, id: string): Account {
  const account = state.accounts.find((item) => item.id === id);
  if (!account) throw new SwapdeckError('NOT_FOUND', id);
  return account;
}
