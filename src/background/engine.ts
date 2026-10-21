import { cycleAccount, decideSave, isEmptySnapshot, type SaveDecision } from '../core/decide';
import { appForUrl, matchPatterns, originOf, parseHttpUrl } from '../core/domains';
import { detectIdentity, hasIdentity, isSpecificDetector, sameIdentity } from '../core/identity';
import { presetForUrl } from '../core/presets';
import type { Account, AppDef, HistoryKind, Identity, Settings, Snapshot, WebStorageDump } from '../core/types';
import { defaultLabel, newId, nextColor } from '../core/util';
import { createTranslator, resolveLanguage, type Translate } from '../i18n/translate';
import { SwapdeckError, type Probe, type SaveOutcome, type SwitchOutcome } from '../shared/protocol';
import { prevSnapKey, readState, snapKey, type State } from '../shared/store';
import { clearCookies, readCookies, writeCookies } from './cookie-jar';
import { blockPageScripts, unblockPageScripts } from './guard';
import { probePage, readPageStorage, showOverlay, writePageStorage, type PageReadResult } from './page-scripts';
import {
  exclusive,
  findAccount,
  loadSnapshot,
  pushHistory,
  readStoredSnapshot,
  sessionStats,
  storeSnapshot,
  update,
} from './state';
import { activeTab, getTab, navigateAndWait, queryAppTabs, runInTab, tabUrl } from './tabs';

/** IndexedDB larger than this isn't saved: it's a cache, not a session, and would bloat storage. */
const IDB_LIMIT_BYTES = 40_000_000;

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
  const page = await runInTab(tabId, readPageStorage, [
    {
      // Local storage is always read: detection may need it even when it isn't swapped.
      local: true,
      session: app.storage.sessionStorage,
      idb: app.storage.indexedDB,
      idbLimitBytes: IDB_LIMIT_BYTES,
    },
  ]);
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

/** Who is signed in, without saving anything. Uses local storage only when the tab is on the app's origin. */
export async function detectLive(app: AppDef, tab: chrome.tabs.Tab | null): Promise<Identity | null> {
  const cookies = await readCookies(app.domains);
  let local: Record<string, string> | undefined;
  if (tab?.id !== undefined && originOf(tabUrl(tab) ?? '') === app.origin) {
    try {
      const page = await runInTab(tab.id, readPageStorage, [
        { local: true, session: false, idb: false, idbLimitBytes: 0 },
      ]);
      if (page.origin === app.origin) local = page.local;
    } catch {
      // The page may be loading or not scriptable (e.g. an error page).
    }
  }
  return detectIdentity(app.detector, { cookies, localStorage: local });
}

/** Opens a hidden tab on the app's static page, runs `task` there, then closes it. */
export async function withStagingTab<T>(app: AppDef, task: (tabId: number) => Promise<T>): Promise<T> {
  const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
  const tabId = tab.id!;
  const ruleId = await blockPageScripts(tabId, app.domains);
  try {
    await openStaging(tabId, app);
    return await task(tabId);
  } finally {
    await unblockPageScripts(ruleId);
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
 * another address, and fails only if none stays on the app's origin.
 */
async function openStaging(tabId: number, app: AppDef): Promise<void> {
  let last = '';
  for (const url of stagingCandidates(app)) {
    await navigateAndWait(tabId, url);
    try {
      const where = await runInTab(tabId, probePage, []);
      if (where.origin === app.origin) return;
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
    if (!hasIdentity(account) || sameIdentity(account, captured.identity)) applyIdentity(account, captured.identity);
  });
  return { accountId, created };
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

async function applySnapshot(app: AppDef, tabId: number, snapshot: Snapshot | null): Promise<void> {
  if (app.storage.cookies) {
    await clearCookies(app.domains);
    if (snapshot) {
      const failed = await writeCookies(snapshot.cookies);
      if (failed.length) console.warn(`Swapdeck: ${failed.length} cookie(s) could not be restored`, failed);
    }
  }
  const kinds = { local: app.storage.localStorage, session: app.storage.sessionStorage, idb: app.storage.indexedDB };
  if (!kinds.local && !kinds.session && !kinds.idb) return;
  const result = await runInTab(tabId, writePageStorage, [
    {
      local: snapshot?.storage.localStorage ?? {},
      session: snapshot?.storage.sessionStorage ?? {},
      idb: snapshot?.storage.indexedDB ?? [],
    },
    kinds,
  ]);
  if (result.origin !== app.origin) throw new SwapdeckError('STAGING_FAILED', result.origin);
  if (result.errors.length) console.warn('Swapdeck: some stored data could not be restored', result.errors);
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
};

/**
 * Switches an app to another saved account (or to a clean, signed-out state).
 *
 * 1. The target session is loaded first, so a locked vault or missing session
 *    fails before anything changes.
 * 2. The app's other tabs are discarded (or reloaded at the end) so their
 *    scripts can't write the old session back.
 * 3. One tab moves to a static page of the site with page scripts blocked.
 * 4. The live session is saved to the account it belongs to (see decideSave).
 * 5. Cookies and storage are replaced; on failure the live session is put back.
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

    const tabs = await queryAppTabs(app);
    const focused = await activeTab();
    let work =
      tabs.find((tab) => tab.id === request.tabId) ??
      tabs.find((tab) => tab.id === focused?.id) ??
      tabs.find((tab) => tab.active) ??
      tabs[0] ??
      null;
    const created = !work;
    const returnUrl = work ? tabUrl(work) : null;
    if (!work && request.background && request.hiddenTabId !== undefined) work = await getTab(request.hiddenTabId);
    const borrowed = created && Boolean(work);
    if (!work) work = await chrome.tabs.create({ url: 'about:blank', active: !request.background });
    const workId = work.id!;

    const reloadLater: number[] = [];
    for (const tab of tabs) {
      if (tab.id === workId || tab.id === undefined || tab.discarded) continue;
      if (!tab.active) {
        try {
          await chrome.tabs.discard(tab.id);
          continue;
        } catch {
          // Pinned-and-playing or otherwise not discardable: reload it at the end.
        }
      }
      reloadLater.push(tab.id);
    }

    const ruleId = await blockPageScripts(workId, app.domains);
    let live: Captured | null = null;
    let swapping = false;
    let saved: SwitchOutcome['saved'] = null;
    let skipped: SwitchOutcome['skipped'];
    try {
      await openStaging(workId, app);
      await runInTab(workId, showOverlay, [
        {
          title: target
            ? t('overlay.switching', { account: target.label })
            : t('overlay.signingOut', { app: app.name }),
          subtitle: t('overlay.subtitle', { app: app.name }),
          color: target?.color ?? app.color,
          theme: state.settings.theme,
        },
      ]).catch(() => undefined);

      live = await capture(app, workId);
      const decision = decideSave({
        accounts: state.accounts.filter((account) => account.appId === app.id),
        activeId: previousId,
        detector: app.detector,
        identity: live.identity,
        empty: isEmptySnapshot(live.snapshot),
      });
      if (decision.kind === 'skip') skipped = decision.reason;
      else saved = await persist(app, live, decision, t);

      // When the live session already is the target account (e.g. re-opening the
      // active account), it is newer than the saved one: keep it as it is.
      if (!target || saved?.accountId !== target.id) {
        swapping = true;
        await applySnapshot(app, workId, targetSnapshot);
      }
    } catch (error) {
      if (swapping && live) await applySnapshot(app, workId, live.snapshot).catch(() => undefined);
      await unblockPageScripts(ruleId);
      if (returnUrl) await chrome.tabs.update(workId, { url: returnUrl }).catch(() => undefined);
      else if (created && !borrowed) await chrome.tabs.remove(workId).catch(() => undefined);
      for (const id of reloadLater) void chrome.tabs.reload(id).catch(() => undefined);
      const code = error instanceof SwapdeckError ? error.code : 'UNKNOWN';
      await update((draft) =>
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
        }),
      );
      throw error;
    }
    await unblockPageScripts(ruleId);

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

    if (created && request.background) {
      // Nothing of the app was open: the swap is done, the hidden tab can go (unless it's borrowed).
      if (!borrowed) await chrome.tabs.remove(workId).catch(() => undefined);
      for (const id of reloadLater) void chrome.tabs.reload(id).catch(() => undefined);
      return { saved, ...(skipped ? { skipped } : {}), tabId: workId };
    }

    pendingToasts.set(workId, {
      appId: app.id,
      accountId: target?.id ?? null,
      kind,
      savedAsNew: saved?.created ? saved.accountId : null,
      at: Date.now(),
    });
    const destination = request.url ?? destinationFor(app, target, state.settings, request.kind, returnUrl);
    const opened = await chrome.tabs.update(workId, { url: destination, ...(request.focus ? { active: true } : {}) });
    if (request.focus && opened?.windowId !== undefined) {
      await chrome.windows.update(opened.windowId, { focused: true }).catch(() => undefined);
    }
    for (const id of reloadLater) void chrome.tabs.reload(id).catch(() => undefined);
    return { saved, ...(skipped ? { skipped } : {}), tabId: workId };
  });
}

/** Switches the app of the given tab to the next (or previous) saved account. */
export async function cycle(tabId: number | undefined, step: 1 | -1): Promise<SwitchOutcome> {
  const tab = tabId !== undefined ? await getTab(tabId) : await activeTab();
  const state = await readState();
  const app = appForUrl(state.apps, tabUrl(tab));
  if (!app) throw new SwapdeckError('NOT_FOUND', 'app');
  const next = cycleAccount(
    state.accounts.filter((account) => account.appId === app.id),
    state.active[app.id],
    step,
  );
  if (!next) throw new SwapdeckError('NO_SESSION');
  return switchTo({ appId: app.id, accountId: next.id, kind: 'switch', tabId: tab?.id });
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
      const owner = appAccounts.find((account) => sameIdentity(account, captured.identity));
      decision = owner ? { kind: 'existing', accountId: owner.id } : { kind: 'new' };
    }
    const saved = await persist(app, captured, decision, t);
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

  const identity = await detectLive(app, tab);
  result.identity = identity;
  const accounts = state.accounts.filter((account) => account.appId === app.id);
  const active = accounts.find((account) => account.id === result.activeId);
  if (identity?.confidence === 'strong') {
    const owner = accounts.find((account) => sameIdentity(account, identity));
    result.matchId = owner?.id ?? (active && !hasIdentity(active) ? active.id : null);
    if (active && result.matchId === active.id) result.status = 'match';
    else if (result.matchId) result.status = 'mismatch';
    else result.status = 'unsaved';
  } else if (isSpecificDetector(app.detector)) {
    result.status = 'signed-out';
  }
  return result;
}
