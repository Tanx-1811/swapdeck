import {
  applyPull,
  isMemoEntry,
  isSyncItem,
  planPull,
  planPush,
  SYNC_PREFIX,
  syncEntries,
  type SyncItem,
  type SyncMemo,
  type SyncStatus,
} from '../core/sync';
import { readState, SESSION_KEYS } from '../shared/store';
import { removeAccount, removeApp, removeWorkspace } from './admin';
import { update } from './state';
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
  const memo: SyncMemo = {};
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
  const remote: Record<string, SyncItem> = {};
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith(SYNC_PREFIX) && isSyncItem(value)) remote[key] = value;
  }
  return remote;
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
  const [remote, memo, removed] = await Promise.all([readRemote(), readMemo(), removedHere()]);
  const plan = planPull(remote, memo);
  const next: SyncMemo = { ...memo };
  for (const key of plan.forget) delete next[key];
  if (plan.upserts.length) {
    const outcome = await update((draft) => applyPull(draft, plan.upserts, next, removed));
    Object.assign(next, outcome.applied);
  }
  // Removed on another computer: remove here too (workspaces, then accounts, then apps), sign-ins included.
  for (const item of plan.deletes) {
    const remove = item.kind === 'workspace' ? removeWorkspace : item.kind === 'account' ? removeAccount : removeApp;
    await remove(item.id).catch(() => undefined);
    delete next[item.key];
  }
  await writeMemo(next);
}

/** Sends what changed here. True when something lost here can be taken back from Chrome Sync. */
async function push(): Promise<boolean> {
  const [state, remote, memo, removed, by] = await Promise.all([
    readState(),
    readRemote(),
    readMemo(),
    removedHere(),
    installId(),
  ]);
  const entries = syncEntries(state);
  const plan = planPush(entries, memo, remote, removed, Date.now(), by);
  const next: SyncMemo = { ...memo };
  if (plan.drop.length) await chrome.storage.sync.remove(plan.drop);
  if (Object.keys(plan.gone).length) await chrome.storage.sync.set(plan.gone);
  for (const key of plan.forget) delete next[key];
  await writeMemo(next);
  try {
    if (Object.keys(plan.set).length) await chrome.storage.sync.set(plan.set);
    Object.assign(next, plan.written);
    await writeMemo(next);
    const items = Object.keys(entries).length - plan.tooBig.length;
    await setStatus({ ok: true, at: Date.now(), items, tooBig: plan.tooBig.length });
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
    await chrome.storage.local.remove(MEMO_KEY);
    await chrome.storage.session.remove(SESSION_KEYS.sync);
  });
}
