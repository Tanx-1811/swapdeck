import type { HistoryKind } from '../core/types';

/*
 * What a switch is doing right now, per app, in chrome.storage.session (memory
 * only, kept while the worker restarts): if the worker stops halfway through a
 * swap, the next start finds the entry and puts the site back in one piece
 * (recoverInterruptedSwaps in engine.ts). Holds ids and addresses only, never
 * a cookie or a token.
 */

export const JOURNAL_KEY = 'sd:swap';

/** A tab of the app moved away (or to the switching page) during the swap, and the page to send it back to. */
export type ParkedTab = { id: number; url: string };

export type SwapJournal = {
  appId: string;
  workId: number;
  parked: ParkedTab[];
  /** Where the work tab was before the switch (null: a tab opened for the switch). */
  returnUrl: string | null;
  /** The work tab only exists for this switch (opened, lent by a workspace switch, or a blank "Open link as" tab). */
  ownTab: boolean;
  from: string | null;
  to: string | null;
  kind: HistoryKind;
  /** The site's cookies and storage are being replaced: they may be half one account, half the other. */
  swapping: boolean;
  /** The account the live session was saved into just before the swap (null: nothing to save, it was signed out). */
  savedInto: string | null;
  at: number;
};

let queue: Promise<unknown> = Promise.resolve();

function run<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.catch(() => undefined);
  return next;
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isText = (value: unknown): value is string => typeof value === 'string';

function sanitize(value: unknown): SwapJournal | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (!isText(item.appId) || !isNumber(item.workId)) return null;
  const parked = Array.isArray(item.parked)
    ? item.parked.flatMap((tab): ParkedTab[] => {
        const entry = tab as Record<string, unknown> | null;
        return entry && isNumber(entry.id) && isText(entry.url) ? [{ id: entry.id, url: entry.url }] : [];
      })
    : [];
  const kinds: HistoryKind[] = ['switch', 'fresh', 'save', 'auto-save', 'restore'];
  return {
    appId: item.appId,
    workId: item.workId,
    parked,
    returnUrl: isText(item.returnUrl) ? item.returnUrl : null,
    ownTab: item.ownTab === true,
    from: isText(item.from) ? item.from : null,
    to: isText(item.to) ? item.to : null,
    kind: kinds.includes(item.kind as HistoryKind) ? (item.kind as HistoryKind) : 'switch',
    swapping: item.swapping === true,
    savedInto: isText(item.savedInto) ? item.savedInto : null,
    at: isNumber(item.at) ? item.at : 0,
  };
}

export async function readJournals(): Promise<SwapJournal[]> {
  const raw: unknown = (await chrome.storage.session.get(JOURNAL_KEY))[JOURNAL_KEY];
  if (!raw || typeof raw !== 'object') return [];
  return Object.values(raw as Record<string, unknown>).flatMap((entry) => {
    const journal = sanitize(entry);
    return journal ? [journal] : [];
  });
}

/** Records (or updates) the switch of an app. */
export function writeJournal(journal: SwapJournal): Promise<void> {
  return run(async () => {
    const raw: unknown = (await chrome.storage.session.get(JOURNAL_KEY))[JOURNAL_KEY];
    const all = raw && typeof raw === 'object' ? { ...(raw as Record<string, unknown>) } : {};
    all[journal.appId] = journal;
    await chrome.storage.session.set({ [JOURNAL_KEY]: all });
  });
}

export function clearJournal(appId: string): Promise<void> {
  return run(async () => {
    const raw: unknown = (await chrome.storage.session.get(JOURNAL_KEY))[JOURNAL_KEY];
    const all = raw && typeof raw === 'object' ? { ...(raw as Record<string, unknown>) } : {};
    delete all[appId];
    if (Object.keys(all).length) await chrome.storage.session.set({ [JOURNAL_KEY]: all });
    else await chrome.storage.session.remove(JOURNAL_KEY);
  });
}
