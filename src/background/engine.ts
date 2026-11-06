import { decideSave, isEmptySnapshot, type SaveDecision } from '../core/decide';
import { appForUrl, matchPatterns, originOf, parseHttpUrl } from '../core/domains';
import { linkOwner } from '../core/links';
import { detectIdentity, hasIdentity, isSpecificDetector, sameIdentity } from '../core/identity';
import { presetForUrl } from '../core/presets';
import type { Account, AppDef, HistoryKind, Identity, Settings, Snapshot, WebStorageDump } from '../core/types';
import { defaultLabel, newId, nextColor } from '../core/util';
import { sanitizeVault } from '../core/validate';
import { createTranslator, resolveLanguage, type Translate } from '../i18n/translate';
import { SwapdeckError, type ErrorCode, type Probe, type SaveOutcome, type SwitchOutcome } from '../shared/protocol';
import { KEYS, prevSnapKey, readState, snapKey, type State } from '../shared/store';
import { clearCookies, readCookies, writeCookies } from './cookie-jar';
import { blockPageScripts, unblockPageScripts } from './guard';
import { probePage, readPageStorage, showOverlay, writePageStorage, type PageReadResult } from './page-scripts';
import {
  exclusive,
  findAccount,
  loadSnapshot,
  packSnapshot,
  pushHistory,
  readStoredSnapshot,
  sessionStats,
  storeSnapshot,
  update,
} from './state';
import { clearJournal, readJournals, writeJournal, type ParkedTab, type SwapJournal } from './swap-journal';
import { activeTab, getTab, navigateAndWait, queryAppTabs, runInTab, tabUrl } from './tabs';

/** IndexedDB larger than this isn't saved: it's a cache, not a session, and would bloat storage. */
const IDB_LIMIT_BYTES = 40_000_000;
/** How long reading a page's storage may take before it counts as stuck (with IndexedDB: much longer). */
const CAPTURE_TIMEOUT_MS = 10_000;
const CAPTURE_IDB_TIMEOUT_MS = 60_000;
/** Detection reads local storage only. */
const DETECT_TIMEOUT_MS = 5_000;
/** Small page scripts (where the page is, the overlay, toasts). */
export const PAGE_SCRIPT_TIMEOUT_MS = 10_000;
/** Moving one of the app's other tabs off the site before a swap. */
const PARK_TIMEOUT_MS = 8_000;

export function translatorFor(settings: Settings): Translate {
  return createTranslator(resolveLanguage(settings.language));
}

export function findApp(state: State, appId: string): AppDef {
  const app = state.apps.find((item) => item.id === appId);
  if (!app) throw new SwapdeckError('NOT_FOUND', appId);
  return app;
}

export async function hasAccess(app: Pick<AppDef, 'domains'>): Promise<boolean> {
  try {
    return await chrome.permissions.contains({ origins: matchPatterns(app) });
  } catch {
    return false;
  }
}

async function requireAccess(app: AppDef): Promise<void> {
  if (!(await hasAccess(app))) throw new SwapdeckError('NO_ACCESS', app.name);
}

// --- Per-app locks -----------------------------------------------------------

const appLocks = new Map<string, Promise<unknown>>();
/** Apps with a switch or save in progress; page loads in them are ignored meanwhile. */
export const busyApps = new Set<string>();
/**
 * Tabs a switch just moved or reloaded (the work tab, the app's other tabs):
 * when, and which other account their page belonged to then. Showing that
 * page again right after the switch is the switch's own doing, not the user
 * opening another account's page: links of another account leave it alone for
 * a while instead of switching straight back.
 */
export const switchedTabs = new Map<number, { at: number; owner: string | null }>();

/** The account (and what says so) a page belongs to when it isn't the one in use, as a comparable key. */
function pageOwnerKey(app: AppDef, accounts: readonly Account[], url: string | null, activeId: string | null) {
  const owner = url ? linkOwner(app, accounts, url, activeId) : null;
  return owner ? `${owner.accountId}|${owner.match}` : null;
}

function noteSwitchedTabs(
  app: AppDef,
  accounts: readonly Account[],
  activeId: string | null,
  pages: readonly { id: number | undefined; url: string | null }[],
): void {
  const now = Date.now();
  for (const [id, note] of switchedTabs) if (now - note.at > 60_000) switchedTabs.delete(id);
  for (const page of pages) {
    if (page.id !== undefined)
      switchedTabs.set(page.id, { at: now, owner: pageOwnerKey(app, accounts, page.url, activeId) });
  }
}

const othersPages = (tabs: readonly chrome.tabs.Tab[]) => tabs.map((tab) => ({ id: tab.id, url: tabUrl(tab) }));

/** Whether a tab still shows the page a switch just sent it to (same owner), within `quietMs`. */
export function justSwitched(tabId: number, owner: { accountId: string; match: string }, quietMs: number): boolean {
  const note = switchedTabs.get(tabId);
  return Boolean(note && Date.now() - note.at < quietMs && note.owner === `${owner.accountId}|${owner.match}`);
}

/**
 * Apps that swap sessionStorage: the tabs whose sessionStorage is known to be
 * the active account's (the last switch wrote it, or the session was saved
 * from there). sessionStorage belongs to one tab, so only these are refreshed
 * automatically: another tab may still hold the previous account's.
 */
export const sessionTabs = new Map<string, Set<number>>();

/**
 * Runs tasks of one app one after another. `busy` tasks (switches, saves) also
 * make the watcher ignore the app's page loads while they run, since those
 * loads are the switch's own (the switching page, the destination).
 */
export function withAppLock<T>(appId: string, task: () => Promise<T>, busy = true): Promise<T> {
  const previous = appLocks.get(appId) ?? Promise.resolve();
  const run = previous.then(async () => {
    if (busy) busyApps.add(appId);
    try {
      return await task();
    } finally {
      if (busy) busyApps.delete(appId);
    }
  });
  appLocks.set(
    appId,
    run.catch(() => undefined),
  );
  return run;
}

// --- Capture -----------------------------------------------------------------

export type Captured = { snapshot: Snapshot; identity: Identity | null; page: PageReadResult };

/** Reads the live session from a tab that is on the app's origin. */
export async function capture(app: AppDef, tabId: number): Promise<Captured> {
  const page = await runInTab(
    tabId,
    readPageStorage,
    [
      {
        // Local storage is always read: detection may need it even when it isn't swapped.
        local: true,
        session: app.storage.sessionStorage,
        idb: app.storage.indexedDB,
        idbLimitBytes: IDB_LIMIT_BYTES,
        expectedOrigin: app.origin,
      },
    ],
    'ISOLATED',
    app.storage.indexedDB ? CAPTURE_IDB_TIMEOUT_MS : CAPTURE_TIMEOUT_MS,
  );
  if (page.origin !== app.origin) throw new SwapdeckError('STAGING_FAILED', page.href);
  if (page.idbError) throw new SwapdeckError('UNKNOWN', page.idbError);
  const cookies = await readCookies(app.domains);
  const identity = detectIdentity(app.detector, { cookies, localStorage: page.local });
  const storage: WebStorageDump = {};
  if (app.storage.localStorage) storage.localStorage = page.local ?? {};
  if (app.storage.sessionStorage) storage.sessionStorage = page.session ?? {};
  if (app.storage.indexedDB) storage.indexedDB = page.idb ?? [];
  const snapshot: Snapshot = {
    v: 1,
    capturedAt: Date.now(),
    origin: app.origin,
    cookies: app.storage.cookies ? cookies : [],
    storage,
  };
  if (identity) snapshot.identity = identity;
  return { snapshot, identity, page };
}

/**
 * Who is signed in, and whether the answer can be trusted to mean "nobody":
 * `readable` is false when detection needs the page's local storage and it
 * couldn't be read (another address of the site, Chrome's own error page while
 * offline, a page that doesn't answer). Then finding nobody means "can't tell".
 */
export type LiveDetection = { identity: Identity | null; readable: boolean };

/** Who is signed in, without saving anything. Uses local storage only when the tab is on the app's origin. */
export async function detectLive(app: AppDef, tab: chrome.tabs.Tab | null): Promise<LiveDetection> {
  const cookies = await readCookies(app.domains);
  let local: Record<string, string> | undefined;
  if (tab?.id !== undefined && originOf(tabUrl(tab) ?? '') === app.origin) {
    try {
      const page = await runInTab(
        tab.id,
        readPageStorage,
        [{ local: true, session: false, idb: false, idbLimitBytes: 0, expectedOrigin: app.origin }],
        'ISOLATED',
        DETECT_TIMEOUT_MS,
      );
      if (page.origin === app.origin) local = page.local;
    } catch {
      // The page may be loading or not scriptable (e.g. an error page).
    }
  }
  const identity = detectIdentity(app.detector, { cookies, localStorage: local });
  const needsLocal = app.detector.kind === 'localStorage' || app.detector.kind === 'auto';
  return { identity, readable: Boolean(identity) || !needsLocal || local !== undefined };
}

/** Opens a hidden tab on the app's static page, runs `task` there, then closes it. */
export async function withStagingTab<T>(app: AppDef, task: (tabId: number) => Promise<T>): Promise<T> {
  const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
  const tabId = tab.id!;
  let ruleId: number | null = null;
  try {
    ruleId = await blockPageScripts(tabId, app.domains);
    await openStaging(tabId, app);
    return await task(tabId);
  } finally {
    if (ruleId !== null) await unblockPageScripts(ruleId);
    await chrome.tabs.remove(tabId).catch(() => undefined);
  }
}

export function stagingUrl(app: AppDef): string {
  return new URL(app.stagingPath || '/robots.txt', app.origin).href;
}

/** Fallbacks when the app's switching page redirects away (e.g. to a sign-in site while signed out). */
const FALLBACK_STAGING = ['/favicon.ico', '/robots.txt', '/'];

/** Every switching page worth trying for an app, its own first. */
export function stagingCandidates(app: AppDef): string[] {
  return [...new Set([stagingUrl(app), ...FALLBACK_STAGING.map((path) => new URL(path, app.origin).href)])];
}

/**
 * Moves a tab to a static page of the app's main address (page scripts are
 * blocked by the caller's rule). Tries the fallbacks when a page redirects to
 * another address, and fails only if none stays on the app's origin. Returns
 * the page it stayed on.
 */
async function openStaging(tabId: number, app: AppDef): Promise<string> {
  let last = '';
  for (const url of stagingCandidates(app)) {
    await navigateAndWait(tabId, url);
    try {
      const where = await runInTab(tabId, probePage, [], 'ISOLATED', PAGE_SCRIPT_TIMEOUT_MS);
      if (where.origin === app.origin) return url;
      last = where.href;
    } catch (error) {
      // Chrome's own error page (e.g. an empty 403): nothing can run there, try the next page.
      if (error instanceof SwapdeckError && error.code === 'NO_ACCESS') throw error;
      last = url;
    }
  }
  throw new SwapdeckError('STAGING_FAILED', last);
}

// --- Saving the live session -------------------------------------------------

function newAccount(draft: State, app: AppDef, identity: Identity | null, t: Translate): Account {
  const siblings = draft.accounts.filter((account) => account.appId === app.id);
  const account: Account = {
    id: newId('acc'),
    appId: app.id,
    label: defaultLabel(identity, t('account.defaultLabel', { n: siblings.length + 1 })),
    color: nextColor(siblings),
    pins: [],
    recents: [],
    order: siblings.reduce((max, item) => Math.max(max, item.order + 1), 0),
    createdAt: Date.now(),
    switchCount: 0,
  };
  applyIdentity(account, identity);
  return account;
}

/** Records who the account is (only call when the identity is known to belong to it). */
export function applyIdentity(account: Account, identity: Identity | null): void {
  if (!identity || identity.confidence !== 'strong') return;
  if (identity.id) account.identityId = identity.id;
  if (identity.email) account.email = identity.email;
  if (identity.name) account.name = identity.name;
  if (identity.avatar) account.avatarUrl = identity.avatar;
}

/**
 * Stores a captured session according to a save decision. `refresh` marks a
 * routine refresh of the same session (auto-sync), which doesn't replace the
 * "previous" copy. Never call inside update().
 */
export async function persist(
  app: AppDef,
  captured: Captured,
  decision: Exclude<SaveDecision, { kind: 'skip' }>,
  t: Translate,
  refresh = false,
): Promise<{ accountId: string; created: boolean }> {
  let accountId: string;
  let created = false;
  if (decision.kind === 'new') {
    accountId = await update((draft) => {
      const account = newAccount(draft, app, captured.identity, t);
      draft.accounts.push(account);
      return account.id;
    });
    created = true;
  } else {
    accountId = decision.accountId;
  }
  await storeSnapshot(accountId, captured.snapshot, { keepPrevious: !refresh });
  await update((draft) => {
    const account = draft.accounts.find((item) => item.id === accountId);
    if (!account) return;
    account.capturedAt = captured.snapshot.capturedAt;
    account.stats = sessionStats(captured.snapshot);
    // A signed-in session saved into it: the account works again.
    if (captured.identity?.confidence === 'strong') delete account.expiredAt;
    if (!hasIdentity(account) || sameIdentity(account, captured.identity)) applyIdentity(account, captured.identity);
  });
  return { accountId, created };
}

/**
 * Keeps a session as an account's "previous" copy without touching the
 * current one (a session that may not be the account's, set aside rather
 * than lost). Sealed like every saved session when a vault exists.
 */
async function storeAsPrevious(accountId: string, snapshot: Snapshot): Promise<void> {
  await exclusive(async () => {
    // Same rule as storeSnapshot: no orphaned sign-in for a removed account, nor after "Delete all data".
    const listed = (await chrome.storage.local.get(KEYS.accounts))[KEYS.accounts];
    if (!Array.isArray(listed) || !listed.some((item) => (item as { id?: unknown } | null)?.id === accountId)) return;
    const vault = sanitizeVault((await chrome.storage.local.get(KEYS.vault))[KEYS.vault]);
    await chrome.storage.local.set({
      [prevSnapKey(accountId)]: await packSnapshot(snapshot, vault?.publicKey ?? null),
    });
  });
}

// --- Switching ---------------------------------------------------------------

export type ToastIntent = {
  appId: string;
  accountId: string | null;
  kind: HistoryKind;
  /** The previous session was saved as a new account. */
  savedAsNew: string | null;
  at: number;
};

/** Confirmations to show once the switched tab has loaded (see watcher.ts). */
export const pendingToasts = new Map<number, ToastIntent>();

function destinationFor(
  app: AppDef,
  target: Account | null,
  settings: Settings,
  kind: 'switch' | 'fresh' | 'restore',
  returnUrl: string | null,
): string {
  if (kind === 'fresh' || !target) return app.loginUrl ?? app.homeUrl;
  if (target.homeUrl) return target.homeUrl;
  const sameApp = (url: string | null | undefined) => Boolean(url && appForUrl([app], url));
  if (settings.afterSwitch === 'same' && sameApp(returnUrl)) return returnUrl!;
  if (settings.afterSwitch === 'last' && sameApp(target.lastUrl)) return target.lastUrl!;
  return app.homeUrl;
}

/** Writing a page's storage is quick; IndexedDB held open elsewhere can block it for good. */
const WRITE_STORAGE_TIMEOUT_MS = 30_000;

/**
 * Replaces the app's cookies and the stored data of the page in `tabId` with
 * a snapshot (null: a clean, signed-out site). `strict`: a database that
 * could not be replaced fails the swap (STORAGE_BLOCKED), since the previous
 * account's data would stay under the new one's cookies.
 */
async function applySnapshot(app: AppDef, tabId: number, snapshot: Snapshot | null, strict = true): Promise<void> {
  if (app.storage.cookies) {
    await clearCookies(app.domains);
    if (snapshot) {
      const failed = await writeCookies(snapshot.cookies);
      if (failed.length) console.warn(`Swapdeck: ${failed.length} cookie(s) could not be restored`, failed);
    }
  }
  const kinds = { local: app.storage.localStorage, session: app.storage.sessionStorage, idb: app.storage.indexedDB };
  if (!kinds.local && !kinds.session && !kinds.idb) return;
  const result = await runInTab(
    tabId,
    writePageStorage,
    [
      {
        local: snapshot?.storage.localStorage ?? {},
        session: snapshot?.storage.sessionStorage ?? {},
        idb: snapshot?.storage.indexedDB ?? [],
      },
      { ...kinds, expectedOrigin: app.origin },
    ],
    'ISOLATED',
    WRITE_STORAGE_TIMEOUT_MS,
  );
  if (result.origin !== app.origin) throw new SwapdeckError('STAGING_FAILED', result.origin);
  if (result.errors.length) console.warn('Swapdeck: some stored data could not be restored', result.errors);
  if (strict && kinds.idb && result.idbFailed) throw new SwapdeckError('STORAGE_BLOCKED', result.errors.join('; '));
}

/**
 * Puts a session back after a failed swap: in the work tab, else (closed or
 * moved elsewhere) in a fresh switching tab under its own rule. If neither
 * works the site is signed out — never left half one account, half the other.
 * Returns whether the session is back.
 */
async function rollBack(app: AppDef, workId: number, snapshot: Snapshot | null): Promise<boolean> {
  try {
    await applySnapshot(app, workId, snapshot, false);
    return true;
  } catch {
    // The work tab is gone or shows another site.
  }
  try {
    await withStagingTab(app, (tabId) => applySnapshot(app, tabId, snapshot, false));
    return true;
  } catch {
    // The site can't be opened either.
  }
  await signOutSite(app);
  return false;
}

/** Clears the app's cookies and, when its switching page opens, its stored data. */
async function signOutSite(app: AppDef): Promise<void> {
  if (app.storage.cookies) await clearCookies(app.domains).catch(() => 0);
  await withStagingTab(app, (tabId) => applySnapshot(app, tabId, null, false)).catch(() => undefined);
}

/** Moves a tab to `url` and waits until it is there (about:blank may load without the usual events). */
async function parkTab(tabId: number, url: string): Promise<boolean> {
  let settled = false;
  const loaded = navigateAndWait(tabId, url, PARK_TIMEOUT_MS).then(
    () => true,
    () => false,
  );
  const polled = (async () => {
    for (let waited = 0; waited < PARK_TIMEOUT_MS && !settled; waited += 200) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      const tab = await getTab(tabId);
      if (!tab) return false;
      if (tab.url === url && tab.status === 'complete') return true;
    }
    return false;
  })();
  const arrived = await Promise.race([loaded, polled]);
  settled = true;
  return arrived;
}

/** Moves tabs off the app so their scripts stop; returns those that arrived. A tab that won't leave is left as it is. */
async function park(tabs: readonly ParkedTab[], url: string): Promise<number[]> {
  const arrived: number[] = [];
  await Promise.all(
    tabs.map(async (tab) => {
      if (await parkTab(tab.id, url)) arrived.push(tab.id);
    }),
  );
  return arrived;
}

/** Sends parked tabs back to their pages (they load with whichever session is now in place). */
function unpark(tabs: readonly ParkedTab[]): void {
  for (const tab of tabs) void chrome.tabs.update(tab.id, { url: tab.url }).catch(() => undefined);
}

export type SwitchRequest = {
  appId: string;
  accountId: string | null;
  kind: 'switch' | 'fresh' | 'restore';
  tabId?: number;
  url?: string;
  /** Bring the switched tab to the front (when started from the manager or the address bar). */
  focus?: boolean;
  /**
   * Don't open the app when none of its tabs is open: swap in a hidden tab and
   * close it (switching a whole workspace, or an app from the popup's list).
   */
  background?: boolean;
  /** The workspace this switch is part of, for the history. */
  via?: string;
  /** A hidden tab to swap in (owned by the caller, who closes it) instead of opening one. */
  hiddenTabId?: number;
  /**
   * `tabId` is a blank tab opened for this switch ("Open link as"): swap in it
   * and open `url` there; it is closed if the switch fails.
   */
  adoptTab?: boolean;
};

/**
 * Switches an app to another saved account (or to a clean, signed-out state).
 *
 * 1. The target session is loaded first, so a locked vault or missing session
 *    fails before anything changes.
 * 2. The app's other tabs are discarded or parked (moved off the site, sent
 *    back at the end) so their scripts can't write the old session back.
 * 3. One tab moves to a static page of the site with page scripts blocked.
 * 4. The live session is saved to the account it belongs to (see decideSave).
 * 5. Cookies and storage are replaced; on failure the live session is put back
 *    (or the site signed out, never left mixed). A journal in session storage
 *    lets the next worker start finish the job if this one stops halfway.
 * 6. The tab opens the destination page; a confirmation shows once it loads.
 */
export function switchTo(request: SwitchRequest): Promise<SwitchOutcome> {
  return withAppLock(request.appId, async () => {
    const state = await readState();
    const app = findApp(state, request.appId);
    await requireAccess(app);
    const t = translatorFor(state.settings);
    const target = request.accountId ? findAccount(state, request.accountId) : null;
    if (target && target.appId !== app.id) throw new SwapdeckError('INVALID');
    const targetSnapshot = target ? await loadSnapshot(target.id) : null;
    const previousId = state.active[app.id] ?? null;
    const previous = previousId ? state.accounts.find((account) => account.id === previousId) : undefined;
    // Choosing the account that is already in use restores (or reopens) it.
    const kind = request.kind === 'switch' && target && target.id === previousId ? 'restore' : request.kind;

    const appAccounts = state.accounts.filter((account) => account.appId === app.id);
    const tabs = await queryAppTabs(app);
    const focused = await activeTab();
    const adopted = request.adoptTab ? await getTab(request.tabId) : null;
    let work =
      adopted ??
      tabs.find((tab) => tab.id === request.tabId) ??
      tabs.find((tab) => tab.id === focused?.id) ??
      tabs.find((tab) => tab.active) ??
      tabs[0] ??
      null;
    const created = !work;
    const returnUrl = work && !adopted ? tabUrl(work) : null;
    if (!work && request.background && request.hiddenTabId !== undefined) work = await getTab(request.hiddenTabId);
    const borrowed = created && Boolean(work);
    if (!work) work = await chrome.tabs.create({ url: 'about:blank', active: !request.background });
    const workId = work.id!;
    /** A tab that only exists for this switch: closed when it fails. */
    const disposable = (created && !borrowed) || Boolean(adopted);
    const others = tabs.filter((tab) => tab.id !== workId);
    if (adopted && request.focus) await chrome.tabs.update(workId, { active: true }).catch(() => undefined);

    // The app's other tabs: inactive ones are discarded (they reload with the new session when
    // activated); the others are parked off the site during the swap. With sessionStorage (one per
    // tab) every tab is parked on the switching page, to receive the new account's sessionStorage.
    const sessionApp = app.storage.sessionStorage;
    const parked: ParkedTab[] = [];
    for (const tab of others) {
      const url = tabUrl(tab);
      if (tab.id === undefined || !url) continue;
      if (!sessionApp) {
        if (tab.discarded) continue;
        if (!tab.active) {
          try {
            await chrome.tabs.discard(tab.id);
            continue;
          } catch {
            // Pinned-and-playing or otherwise not discardable: park it.
          }
        }
      }
      parked.push({ id: tab.id, url });
    }

    const journal: SwapJournal = {
      appId: app.id,
      workId,
      parked,
      returnUrl,
      ownTab: created || Boolean(adopted),
      from: previousId,
      to: target?.id ?? null,
      kind,
      swapping: false,
      savedInto: null,
      at: Date.now(),
    };
    await writeJournal(journal);

    let ruleId: number | null = null;
    let live: Captured | null = null;
    let swapping = false;
    let swapped = false;
    let saved: SwitchOutcome['saved'] = null;
    let skipped: SwitchOutcome['skipped'];
    let written: number[] = [];
    try {
      ruleId = await blockPageScripts(sessionApp ? [workId, ...parked.map((tab) => tab.id)] : workId, app.domains);
      const stagedAt = await openStaging(workId, app);
      const arrived = await park(parked, sessionApp ? stagedAt : 'about:blank');
      await runInTab(
        workId,
        showOverlay,
        [
          {
            title: target
              ? t('overlay.switching', { account: target.label })
              : t('overlay.signingOut', { app: app.name }),
            subtitle: t('overlay.subtitle', { app: app.name }),
            color: target?.color ?? app.color,
            theme: state.settings.theme,
          },
        ],
        'ISOLATED',
        PAGE_SCRIPT_TIMEOUT_MS,
      ).catch(() => undefined);

      live = await capture(app, workId);
      const strongLive = live.identity?.confidence === 'strong' ? live.identity : null;
      // Proof that the live session already is the target's: the same person, recognised.
      const liveIsTarget = Boolean(target && strongLive && sameIdentity(target, strongLive));
      let decision = decideSave({
        accounts: appAccounts,
        activeId: previousId,
        detector: app.detector,
        identity: live.identity,
        empty: isEmptySnapshot(live.snapshot),
      });
      let setAside = false;
      if (kind === 'restore' && target && !liveIsTarget && decision.kind === 'active') {
        // Putting the account's saved session back: without proof that the live session is the
        // same person, it must not replace what is being restored. Someone recognised is kept as
        // a new account; anything else is set aside as the account's "previous" copy.
        if (strongLive) decision = { kind: 'new' };
        else {
          decision = { kind: 'skip', reason: 'signed-out' };
          setAside = true;
        }
      }
      if (decision.kind === 'skip') skipped = decision.reason;
      else saved = await persist(app, live, decision, t);
      if (setAside && target) await storeAsPrevious(target.id, live.snapshot);

      // When the live session provably is the target account (e.g. re-opening the active account),
      // it is newer than the saved one: keep it as it is.
      if (!(liveIsTarget && saved?.accountId === target?.id)) {
        swapping = true;
        await writeJournal({ ...journal, swapping: true, savedInto: saved?.accountId ?? null });
        await applySnapshot(app, workId, targetSnapshot);
        swapped = true;
        if (sessionApp) written = await writeSessionStorage(app, arrived, targetSnapshot);
      }
    } catch (error) {
      let code: ErrorCode = error instanceof SwapdeckError ? error.code : 'UNKNOWN';
      const restored = swapping && live ? await rollBack(app, workId, live.snapshot) : true;
      if (!restored) code = 'ROLLBACK_FAILED';
      if (ruleId !== null) await unblockPageScripts(ruleId);
      if (returnUrl) await chrome.tabs.update(workId, { url: returnUrl }).catch(() => undefined);
      else if (disposable) await chrome.tabs.remove(workId).catch(() => undefined);
      unpark(parked);
      await update((draft) => {
        // Signed out rather than mixed: no saved account is in use any more.
        if (!restored) draft.active[app.id] = null;
        pushHistory(draft, {
          kind,
          appId: app.id,
          appName: app.name,
          fromId: previousId,
          fromLabel: previous?.label,
          toId: target?.id ?? null,
          toLabel: target?.label,
          ok: false,
          error: code,
          ...(request.via ? { via: request.via } : {}),
        });
      });
      noteSwitchedTabs(app, appAccounts, restored ? previousId : null, [
        { id: workId, url: returnUrl },
        ...othersPages(others),
      ]);
      await clearJournal(app.id);
      throw restored ? error : new SwapdeckError('ROLLBACK_FAILED', app.name);
    }
    if (ruleId !== null) await unblockPageScripts(ruleId);

    await update((draft) => {
      draft.active[app.id] = target?.id ?? null;
      const account = target && draft.accounts.find((item) => item.id === target.id);
      if (account) {
        account.lastUsedAt = Date.now();
        account.switchCount += 1;
      }
      pushHistory(draft, {
        kind,
        appId: app.id,
        appName: app.name,
        fromId: previousId,
        fromLabel: previous?.label,
        toId: target?.id ?? null,
        toLabel: target?.label,
        ok: true,
        ...(request.via ? { via: request.via } : {}),
      });
    });
    if (sessionApp) {
      // sessionStorage now holds the target's in the tabs written; without a swap, the work tab's is the live one.
      const trusted = swapped ? new Set<number>() : new Set(sessionTabs.get(app.id) ?? []);
      for (const id of [workId, ...written]) trusted.add(id);
      sessionTabs.set(app.id, trusted);
    }

    if (created && request.background) {
      // Nothing of the app was open: the swap is done, the hidden tab can go (unless it's borrowed).
      if (!borrowed) await chrome.tabs.remove(workId).catch(() => undefined);
      noteSwitchedTabs(app, appAccounts, target?.id ?? null, othersPages(others));
      unpark(parked);
      await clearJournal(app.id);
      return { saved, ...(skipped ? { skipped } : {}), tabId: workId };
    }

    pendingToasts.set(workId, {
      appId: app.id,
      accountId: target?.id ?? null,
      kind,
      savedAsNew: saved?.created ? saved.accountId : null,
      at: Date.now(),
    });
    // A page asked for (a recent project, a link) must be one of the app's own.
    const asked = request.url && appForUrl([app], request.url) ? request.url : null;
    const destination = asked ?? destinationFor(app, target, state.settings, request.kind, returnUrl);
    noteSwitchedTabs(app, appAccounts, target?.id ?? null, [{ id: workId, url: destination }, ...othersPages(others)]);
    const opened = await chrome.tabs.update(workId, { url: destination, ...(request.focus ? { active: true } : {}) });
    if (request.focus && opened?.windowId !== undefined) {
      await chrome.windows.update(opened.windowId, { focused: true }).catch(() => undefined);
    }
    unpark(parked);
    await clearJournal(app.id);
    return { saved, ...(skipped ? { skipped } : {}), tabId: workId };
  });
}

/** Gives the app's parked tabs (on its switching page) the target's sessionStorage; returns those written. */
async function writeSessionStorage(app: AppDef, tabIds: readonly number[], snapshot: Snapshot | null) {
  const written: number[] = [];
  await Promise.all(
    tabIds.map((tabId) =>
      runInTab(
        tabId,
        writePageStorage,
        [
          { session: snapshot?.storage.sessionStorage ?? {} },
          { local: false, session: true, idb: false, expectedOrigin: app.origin },
        ],
        'ISOLATED',
        PAGE_SCRIPT_TIMEOUT_MS,
      ).then(
        (result) => {
          if (result.origin === app.origin) written.push(tabId);
        },
        () => undefined,
      ),
    ),
  );
  return written;
}

/**
 * After the worker stopped in the middle of a swap (the journal is still
 * there when it starts again): puts back the session saved just before the
 * swap, or signs the site out when that can't be done, and sends the tabs
 * the switch moved back to their pages.
 */
export async function recoverInterruptedSwaps(): Promise<void> {
  for (const entry of await readJournals()) {
    await withAppLock(entry.appId, () => recoverSwap(entry)).catch((error: unknown) =>
      console.warn('Swapdeck: could not recover an interrupted switch', error),
    );
  }
}

async function recoverSwap(entry: SwapJournal): Promise<void> {
  try {
    const state = await readState();
    const app = state.apps.find((item) => item.id === entry.appId);
    // The swap had started and its end was never recorded: the site may hold two accounts' data.
    if (app && entry.swapping && (state.active[app.id] ?? null) !== entry.to) {
      let restored = false;
      try {
        const snapshot = entry.savedInto ? await loadSnapshot(entry.savedInto) : null;
        await withStagingTab(app, (tabId) => applySnapshot(app, tabId, snapshot, false));
        restored = true;
      } catch {
        await signOutSite(app);
      }
      const labelOf = (id: string | null) => state.accounts.find((account) => account.id === id)?.label;
      await update((draft) => {
        if (!restored) draft.active[app.id] = null;
        pushHistory(draft, {
          kind: entry.kind,
          appId: app.id,
          appName: app.name,
          fromId: entry.from,
          fromLabel: labelOf(entry.from),
          toId: entry.to,
          toLabel: labelOf(entry.to),
          ok: false,
          error: restored ? 'INTERRUPTED' : 'ROLLBACK_FAILED',
        });
      });
    }
    // Tabs the switch moved: back to their pages; its own tab closed.
    for (const tab of entry.parked) {
      const now = await getTab(tab.id);
      if (now && tabUrl(now) !== tab.url) await chrome.tabs.update(tab.id, { url: tab.url }).catch(() => undefined);
    }
    if (entry.ownTab) await chrome.tabs.remove(entry.workId).catch(() => undefined);
    else if (entry.returnUrl && (await getTab(entry.workId))) {
      await chrome.tabs.update(entry.workId, { url: entry.returnUrl }).catch(() => undefined);
    }
  } finally {
    await clearJournal(entry.appId);
  }
}

/**
 * Saves the session that is live right now, from a tab on the app's origin or,
 * if there is none, from a hidden tab. `target` forces a new account or a
 * specific one; by default the signed-in identity decides.
 */
export function saveLive(appId: string, tabId?: number, target?: 'new' | string): Promise<SaveOutcome> {
  return withAppLock(appId, async () => {
    const state = await readState();
    const app = findApp(state, appId);
    await requireAccess(app);
    const t = translatorFor(state.settings);
    const tabs = await queryAppTabs(app);
    const onOrigin =
      tabs.find((tab) => tab.id === tabId && originOf(tabUrl(tab) ?? '') === app.origin) ??
      tabs.find((tab) => originOf(tabUrl(tab) ?? '') === app.origin);
    const captured = onOrigin?.id
      ? await capture(app, onOrigin.id)
      : await withStagingTab(app, (stagingId) => capture(app, stagingId));
    if (isEmptySnapshot(captured.snapshot)) throw new SwapdeckError('NO_SESSION');

    const appAccounts = state.accounts.filter((account) => account.appId === app.id);
    let decision: Exclude<SaveDecision, { kind: 'skip' }>;
    if (target === 'new') {
      decision = { kind: 'new' };
    } else if (target) {
      const account = findAccount(state, target);
      if (account.appId !== app.id) throw new SwapdeckError('INVALID');
      if (
        hasIdentity(account) &&
        captured.identity?.confidence === 'strong' &&
        !sameIdentity(account, captured.identity)
      ) {
        // Never file one person's session under another person's account.
        throw new SwapdeckError('INVALID', 'identity');
      }
      decision = { kind: 'existing', accountId: account.id };
    } else {
      // A weak guess at who is signed in is shown, never acted on: without a strong match, keep it as new.
      const strong = captured.identity?.confidence === 'strong' ? captured.identity : null;
      const owner = strong ? appAccounts.find((account) => sameIdentity(account, strong)) : undefined;
      decision = owner ? { kind: 'existing', accountId: owner.id } : { kind: 'new' };
    }
    const saved = await persist(app, captured, decision, t);
    if (app.storage.sessionStorage && onOrigin?.id !== undefined) sessionTabs.set(app.id, new Set([onOrigin.id]));
    await update((draft) => {
      draft.active[app.id] = saved.accountId;
      const account = draft.accounts.find((item) => item.id === saved.accountId);
      pushHistory(draft, {
        kind: 'save',
        appId: app.id,
        appName: app.name,
        toId: saved.accountId,
        toLabel: account?.label,
        ok: true,
      });
    });
    return { ...saved, identity: captured.identity };
  });
}

/** Swaps an account's saved session with the one saved before it. */
export async function restorePrevious(accountId: string): Promise<void> {
  const previous = await exclusive(async () => {
    const before = await readStoredSnapshot(accountId, true);
    const current = await readStoredSnapshot(accountId, false);
    if (!before) throw new SwapdeckError('NO_SESSION');
    await chrome.storage.local.set({
      [snapKey(accountId)]: before,
      ...(current ? { [prevSnapKey(accountId)]: current } : {}),
    });
    return before;
  });
  // The stats of a sealed session are only known after unlocking; keep what is shown otherwise.
  const snapshot = 'plain' in previous ? previous.plain : await loadSnapshot(accountId).catch(() => null);
  await update((draft) => {
    const account = draft.accounts.find((item) => item.id === accountId);
    if (!account || !snapshot) return;
    account.capturedAt = snapshot.capturedAt;
    account.stats = sessionStats(snapshot);
  });
}

// --- Probe -------------------------------------------------------------------

export async function probe(tabId?: number): Promise<Probe> {
  const tab = tabId !== undefined ? await getTab(tabId) : await activeTab();
  const url = tabUrl(tab);
  const state = await readState();
  const app = appForUrl(state.apps, url);
  const result: Probe = {
    tabId: tab?.id ?? null,
    url: parseHttpUrl(url) ? url : null,
    appId: app?.id ?? null,
    presetId: app ? null : (presetForUrl(url)?.id ?? null),
    access: false,
    identity: null,
    activeId: app ? (state.active[app.id] ?? null) : null,
    matchId: null,
    status: 'unknown',
  };
  if (!app) return result;
  result.access = await hasAccess(app);
  if (!result.access || busyApps.has(app.id)) return result;

  const { identity, readable } = await detectLive(app, tab);
  result.identity = identity;
  const accounts = state.accounts.filter((account) => account.appId === app.id);
  const active = accounts.find((account) => account.id === result.activeId);
  if (identity?.confidence === 'strong') {
    const owner = accounts.find((account) => sameIdentity(account, identity));
    result.matchId = owner?.id ?? (active && !hasIdentity(active) ? active.id : null);
    if (active && result.matchId === active.id) result.status = 'match';
    else if (result.matchId) result.status = 'mismatch';
    else result.status = 'unsaved';
  } else if (isSpecificDetector(app.detector) && readable) {
    result.status = 'signed-out';
  }
  return result;
}
