import {
  applyPull,
  fitPush,
  isMemoEntry,
  isSyncItem,
  planPull,
  planPush,
  settleDeletes,
  SYNC_PREFIX,
  syncEntries,
  type SyncItem,
  type SyncMemo,
  type SyncStatus,
} from '../core/sync';
import { record } from '../core/util';
import { readState, SESSION_KEYS } from '../shared/store';
import { removeAccount, removeApp, removeWorkspace } from './admin';
import { exclusive, update } from './state';
import { readRemoved } from './sync-journal';

/**
 * Keeps the list (apps, accounts, workspaces) in step across computers through
 * chrome.storage.sync when the user turns it on (Settings → Sync the list).
 * Sign-ins never leave this computer. The rules are in src/core/sync.ts.
 */

/** What this installation last wrote or applied, per sync key (local: survives restarts). */
const MEMO_KEY = 'sd:syncMemo';
/** This installation's id, written into each item it sends. */
const INSTALL_KEY = 'sd:install';
/** Tombstone key → when this computer first saw it (local clock): tombstones expire by it. */
const GONE_SEEN_KEY = 'sd:syncGoneSeen';

let chain: Promise<unknown> = Promise.resolve();
/** One sync at a time. */
function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.catch(() => undefined);
  return run;
}

async function installId(): Promise<string> {
  const stored = (await chrome.storage.local.get(INSTALL_KEY))[INSTALL_KEY];
  if (typeof stored === 'string' && stored) return stored;
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ [INSTALL_KEY]: id });
  return id;
}

async function readMemo(): Promise<SyncMemo> {
  const raw: unknown = (await chrome.storage.local.get(MEMO_KEY))[MEMO_KEY];
  const memo: SyncMemo = record();
  if (!raw || typeof raw !== 'object') return memo;
  for (const [key, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (key.startsWith(SYNC_PREFIX) && isMemoEntry(entry)) memo[key] = entry;
  }
  return memo;
}

async function writeMemo(memo: SyncMemo): Promise<void> {
  await chrome.storage.local.set({ [MEMO_KEY]: memo });
}

async function readRemote(): Promise<Record<string, SyncItem>> {
  const all = await chrome.storage.sync.get(null);
  const remote = record<SyncItem>();
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith(SYNC_PREFIX) && isSyncItem(value)) remote[key] = value;
  }
  return remote;
}

async function readGoneSeen(): Promise<Record<string, number>> {
  const raw: unknown = (await chrome.storage.local.get(GONE_SEEN_KEY))[GONE_SEEN_KEY];
  const seen = record<number>();
  if (!raw || typeof raw !== 'object') return seen;
  for (const [key, at] of Object.entries(raw as Record<string, unknown>)) {
    if (key.startsWith(SYNC_PREFIX) && typeof at === 'number' && Number.isFinite(at)) seen[key] = at;
  }
  return seen;
}

async function removedHere(): Promise<Set<string>> {
  return new Set(Object.keys(await readRemoved()));
}

async function setStatus(status: SyncStatus): Promise<void> {
  await chrome.storage.session.set({ [SESSION_KEYS.sync]: status });
}

function failure(error: unknown, tooBig = 0): SyncStatus {
  const message = error instanceof Error ? error.message : String(error);
  return {
    ok: false,
    at: Date.now(),
    items: 0,
    tooBig,
    error: /quota|max_items|too many/i.test(message) ? 'quota' : 'unknown',
  };
}

/** Takes what other computers changed, then sends what changed here. */
export function syncNow(): Promise<void> {
  return serial(async () => {
    if (!(await readState()).settings.syncList) return;
    try {
      await pull();
      // Something went missing here without being removed: take it back from Chrome Sync.
      if (await push()) {
        await pull();
        await push();
      }
    } catch (error) {
      await setStatus(failure(error));
    }
  });
}

async function pull(): Promise<void> {
  // A second round takes what had to wait for a removal of the first (an app set up again on its site).
  if (await pullOnce()) await pullOnce();
}

/** One pull. Returns how many writes wait for a removal it made. */
async function pullOnce(): Promise<number> {
  const [remote, memo] = await Promise.all([readRemote(), readMemo()]);
  const plan = planPull(remote, memo);
  const next: SyncMemo = { ...memo };
  for (const key of plan.forget) delete next[key];
  let deferred = 0;
  if (plan.upserts.length) {
    // Removals note themselves inside their own update(): reading the journal in this one sees
    // exactly the removals made before it, so nothing removed meanwhile comes back. Nothing new is
    // matched to what this pull's tombstones remove (removed and added again elsewhere: both stay apart).
    const outcome = await update(async (draft) =>
      applyPull(draft, plan.upserts, next, await removedHere(), plan.deletes),
    );
    Object.assign(next, outcome.applied);
    deferred = outcome.deferred;
  }
  // Removed on another computer: remove here too (workspaces, then accounts, then apps), sign-ins included —
  // unless a key applied just now still stands for the thing.
  const settled = settleDeletes(plan.deletes, remote, next);
  for (const key of settled.forget) delete next[key];
  for (const item of settled.deletes) {
    const remove = item.kind === 'workspace' ? removeWorkspace : item.kind === 'account' ? removeAccount : removeApp;
    await remove(item.id).catch(() => undefined);
    delete next[item.key];
  }
  await writeMemo(next);
  return deferred;
}

/** Sends what changed here. True when something lost here can be taken back from Chrome Sync. */
async function push(): Promise<boolean> {
  // The list and the removal journal as one consistent view (read in the write queue): read apart,
  // a removal in between would look like lost data, and the next pull would bring it back.
  const [state, removed] = await exclusive(async () => [await readState(), await removedHere()] as const);
  const [remote, memo, by, goneSeen] = await Promise.all([readRemote(), readMemo(), installId(), readGoneSeen()]);
  const entries = syncEntries(state);
  const plan = planPush(entries, memo, remote, removed, Date.now(), by, goneSeen);
  const next: SyncMemo = { ...memo };
  if (plan.drop.length) await chrome.storage.sync.remove(plan.drop);
  if (Object.keys(plan.gone).length) await chrome.storage.sync.set(plan.gone);
  await chrome.storage.local.set({ [GONE_SEEN_KEY]: plan.goneSeen });
  for (const key of plan.forget) delete next[key];
  for (const [key, entry] of Object.entries(plan.based)) if (next[key]) next[key] = entry;
  await writeMemo(next);
  try {
    // Send what fits; the rest waits for room (one set() over the quota would write nothing, every time).
    const { fit, left } = fitPush(plan.set, await chrome.storage.sync.get(null), {
      quotaBytes: chrome.storage.sync.QUOTA_BYTES ?? 102_400,
      maxItems: chrome.storage.sync.MAX_ITEMS ?? 512,
    });
    if (Object.keys(fit).length) await chrome.storage.sync.set(fit);
    for (const [key, entry] of Object.entries(plan.written)) if (key in fit) next[key] = entry;
    await writeMemo(next);
    const items = Object.keys(entries).length - plan.tooBig.length - left.length;
    await setStatus({
      ok: true,
      at: Date.now(),
      items,
      tooBig: plan.tooBig.length,
      ...(left.length ? { full: left.length, error: 'quota' as const } : {}),
    });
  } catch (error) {
    await setStatus(failure(error, plan.tooBig.length));
  }
  return plan.forget.some((key) => remote[key] && !remote[key].gone && !(key in plan.gone));
}

/**
 * Removes the list from Chrome Sync. Nothing is removed on any computer (only
 * tombstones remove things); computers that still sync send their list again.
 */
export function clearSyncData(): Promise<void> {
  return serial(async () => {
    const keys = Object.keys(await chrome.storage.sync.get(null)).filter((key) => key.startsWith(SYNC_PREFIX));
    if (keys.length) await chrome.storage.sync.remove(keys);
    await chrome.storage.local.remove([MEMO_KEY, GONE_SEEN_KEY]);
    await chrome.storage.session.remove(SESSION_KEYS.sync);
  });
}
