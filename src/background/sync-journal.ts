import { syncKey, type SyncKind } from '../core/sync';

/**
 * What the user removed on purpose, by sync key → when. Only these are removed
 * on the other computers; anything else that disappears from this computer
 * (lost data) is brought back by the next sync instead. Written by the
 * removal functions in admin.ts, inside their update() task, before the state
 * changes — kept even while sync is off, so removals made then still count.
 */
const REMOVED_KEY = 'sd:syncRemoved';
const KEEP_MS = 180 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 3000;

export async function readRemoved(now = Date.now()): Promise<Record<string, number>> {
  const raw: unknown = (await chrome.storage.local.get(REMOVED_KEY))[REMOVED_KEY];
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, at] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof at === 'number' && now - at < KEEP_MS) out[key] = at;
  }
  return out;
}

export async function noteRemoved(things: { kind: SyncKind; id: string }[]): Promise<void> {
  if (!things.length) return;
  const now = Date.now();
  const removed = await readRemoved(now);
  for (const { kind, id } of things) removed[syncKey(kind, id)] = now;
  const kept = Object.entries(removed)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_ENTRIES);
  await chrome.storage.local.set({ [REMOVED_KEY]: Object.fromEntries(kept) });
}
