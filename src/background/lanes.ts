/**
 * Separate tabs (VI "tab riêng"): an account used in some tabs while the browser's other tabs keep
 * the account in use — see core/lanes.ts for how a lane keeps its sign-in apart, and
 * docs/ARCHITECTURE.md §6a. This module runs lanes in the worker:
 *
 * - opening one (a saved account's session, or a scratch sign-in), its tabs grouped under its name;
 * - keeping its cookie jar: Set-Cookie of its responses (webRequest), document.cookie writes
 *   (the page relay), expiry; and its declarativeNetRequest rules in step with the jar and its tabs;
 * - loading a page again when it went out with stale cookies (a redirect that set cookies, a tab
 *   that joined the lane mid-load, a page served from the browser's cache without its lane);
 * - saving the lane's session into its account (identity-checked, like auto-sync), and once more
 *   when the lane ends; giving the account back to the browser's own tabs when a switch needs it;
 * - bringing account lanes back after Chrome restarts (by their tab groups).
 */
import { decideSave, isEmptySnapshot, type SaveDecision } from '../core/decide';
import { appForUrl, hostMatchesDomain, matchPatterns, originOf, parseHttpUrl } from '../core/domains';
import { detectIdentity, hasIdentity, isSpecificDetector, sameIdentity } from '../core/identity';
import {
  cookieApplies,
  cookieHeader,
  LANE_REGEX_BUDGET,
  LANE_RULE_BASE,
  LANE_RULE_BUDGET,
  LANE_WIDE_RULES,
  laneJar,
  laneRules,
  newLaneToken,
  parseCookie,
  purgeExpired,
  regexCount,
  scriptCookies,
  storeCookie,
} from '../core/lanes';
import { laneTitle, sanitizeRestore, type Lane, type LaneRestore } from '../core/lane-registry';
import { recentFor, upsertRecent } from '../core/recents';
import type { Account, AppDef, Identity, Snapshot, WebStorageDump } from '../core/types';
import { initials, readableTextColor, WARNING_COLOR } from '../core/util';
import { tabGroupColor } from '../core/workspaces';
import { SwapdeckError, type SaveOutcome } from '../shared/protocol';
import { readState, type State } from '../shared/store';
import {
  findApp,
  hasAccess,
  openStaging,
  PAGE_SCRIPT_TIMEOUT_MS,
  persist,
  translatorFor,
  withAppLock,
  withStagingTab,
  type Captured,
} from './engine';
import { blockPageScripts, unblockPageScripts } from './guard';
import {
  addLane,
  addTabToLane,
  allLanes,
  dropLane,
  laneByToken,
  laneOfAccount,
  laneOfTab,
  lanesReady,
  removeTabFromLane,
  resetLaneState,
  saveLanes,
  setLaneReleaser,
} from './lane-state';
import {
  dropLaneData,
  readPageStorage,
  showRibbon,
  showToast,
  writePageStorage,
  type PageReadResult,
} from './page-scripts';
import { findAccount, loadSnapshot, pushHistory, update } from './state';
import type { ParkedTab } from './swap-journal';
import { getTab, navigateAndWait, runInTab, tabUrl } from './tabs';

/** Lanes to bring back after a restart (local storage: the browser's tab groups outlive the session). */
const RESTORE_KEY = 'sd:laneRestore';
/** Lane names some origin may still hold (a lane that ended without a page of its site to clean up). */
const LEFTOVERS_KEY = 'sd:laneLeftovers';
const CONTENT_SCRIPTS = ['swapdeck-lane-main', 'swapdeck-lane-relay'] as const;
/** A lane's session is saved into its account at most this often while it's used. */
const CAPTURE_INTERVAL_MS = 30_000;
/** …and this long after its cookies last changed (a sign-in sets several in a row). */
const CAPTURE_DELAY_MS = 4_000;
const IDB_LIMIT_BYTES = 40_000_000;

function warn(what: string) {
  return (error: unknown) => console.warn(`Swapdeck: ${what}`, error);
}

// --- Rules ---------------------------------------------------------------------

/** Rule ids of lanes that ended, still to be removed (by the rules queue, never alongside it). */
const retired = new Map<string, number[]>();
/**
 * When each lane tab's rules were last in place (after Chrome applied them). A request a tab sent
 * before that carried the browser's cookies, not the lane's: what its response sets isn't the lane's.
 */
const coveredAt = new Map<number, number>();

/** Rule ids for a lane: its own first, then free ids of the lane range (never one waiting to be removed). */
function ruleIdsFor(lane: Lane, count: number): number[] {
  const used = new Set([
    ...allLanes().flatMap((item) => (item === lane ? [] : item.ruleIds)),
    ...[...retired.values()].flat(),
  ]);
  const ids = lane.ruleIds.filter((id) => !used.has(id)).slice(0, count);
  for (let next = LANE_RULE_BASE; ids.length < count; next++) {
    if (!used.has(next) && !ids.includes(next)) ids.push(next);
  }
  return ids;
}

async function removeRules(ids: number[]): Promise<void> {
  if (ids.length)
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: ids }).catch(warn('lane rules'));
}

async function applyRules(token: string): Promise<void> {
  const lane = laneByToken(token);
  if (!lane) {
    // The lane ended: its rules go (and nothing of it is added again).
    const ids = retired.get(token) ?? [];
    retired.delete(token);
    await removeRules(ids);
    return;
  }
  const state = await readState();
  // Ended while the state was read: take the removal path instead.
  if (laneByToken(token) !== lane) return applyRules(token);
  const app = state.apps.find((item) => item.id === lane.appId);
  if (!app || !lane.tabIds.length) {
    await removeRules(lane.ruleIds);
    lane.ruleIds = [];
    void saveLanes();
    return;
  }
  lane.jar = purgeExpired(lane.jar);
  const tabIds = [...lane.tabIds];
  const rules = laneRules({ token, tabIds, domains: app.domains, jar: lane.jar });
  const others = allLanes().filter((item) => item !== lane);
  const total = others.reduce((sum, item) => sum + item.ruleIds.length, 0) + rules.length;
  // Every lane rule but the lane-wide ones uses a regex.
  const regexes =
    others.reduce((sum, item) => sum + Math.max(0, item.ruleIds.length - LANE_WIDE_RULES), 0) + regexCount(rules);
  if (total > LANE_RULE_BUDGET || regexes > LANE_REGEX_BUDGET) throw new SwapdeckError('BUSY', 'lanes');
  const ids = ruleIdsFor(lane, rules.length);
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [...new Set([...lane.ruleIds, ...ids])],
    addRules: rules.map((rule, index) => ({ ...rule, id: ids[index]! }) as chrome.declarativeNetRequest.Rule),
  });
  lane.ruleIds = ids;
  if (laneByToken(token) !== lane) {
    // Ended while the rules were written: take them away again at once.
    await removeRules(ids);
    lane.ruleIds = [];
    return;
  }
  const now = Date.now();
  for (const tabId of tabIds) if (!coveredAt.has(tabId)) coveredAt.set(tabId, now);
  await saveLanes();
}

const dirtyRules = new Set<string>();
let rulesWaiters: { token: string; resolve: () => void; reject: (error: unknown) => void }[] = [];
let rulesRunning = false;

/**
 * Brings the lane's rules in step with its jar and tabs (or removes them, once it ended). Updates
 * are applied one at a time and coalesced; the promise settles once the rules reflect the lane as
 * it was when this was called, and fails only when that lane's rules couldn't be written.
 */
function syncRules(token: string): Promise<void> {
  dirtyRules.add(token);
  const done = new Promise<void>((resolve, reject) => rulesWaiters.push({ token, resolve, reject }));
  if (!rulesRunning) void runRules();
  return done;
}

async function runRules(): Promise<void> {
  rulesRunning = true;
  try {
    while (dirtyRules.size) {
      const batch = [...dirtyRules];
      dirtyRules.clear();
      const waiters = rulesWaiters;
      rulesWaiters = [];
      const failures = new Map<string, unknown>();
      for (const token of batch) {
        try {
          await applyRules(token);
        } catch (error) {
          failures.set(token, error);
          warn('lane rules')(error);
        }
      }
      for (const waiter of waiters) {
        if (failures.has(waiter.token)) waiter.reject(failures.get(waiter.token));
        else waiter.resolve();
      }
    }
  } finally {
    rulesRunning = false;
  }
}

/** Rules of the lane range that no lane owns (left by a worker that stopped mid-way): removed at start. */
async function removeOrphanRules(): Promise<void> {
  const owned = new Set(allLanes().flatMap((lane) => lane.ruleIds));
  const rules = await chrome.declarativeNetRequest.getSessionRules().catch(() => []);
  await removeRules(rules.map((rule) => rule.id).filter((id) => id >= LANE_RULE_BASE && !owned.has(id)));
}

// --- Machinery that only runs while lanes exist --------------------------------

let listenedPatterns = '';
let heartbeat: ReturnType<typeof setInterval> | undefined;

async function lanePatterns(state?: State): Promise<string[]> {
  const known = state ?? (await readState());
  const patterns = new Set<string>();
  for (const lane of allLanes()) {
    const app = known.apps.find((item) => item.id === lane.appId);
    if (app) for (const pattern of matchPatterns(app)) patterns.add(pattern);
  }
  return [...patterns].sort();
}

/** Page scripts, request listeners and the keep-alive follow the lanes that exist. */
async function refreshMachinery(): Promise<void> {
  const patterns = await lanePatterns();
  const key = patterns.join(' ');

  if (key !== listenedPatterns) {
    chrome.webRequest.onHeadersReceived.removeListener(onHeadersReceived);
    chrome.webRequest.onSendHeaders.removeListener(onSendHeaders);
    listenedPatterns = key;
    if (patterns.length) {
      chrome.webRequest.onHeadersReceived.addListener(onHeadersReceived, { urls: patterns }, [
        'responseHeaders',
        'extraHeaders',
      ] as chrome.webRequest.OnHeadersReceivedOptions[]);
      chrome.webRequest.onSendHeaders.addListener(onSendHeaders, { urls: patterns }, [
        'requestHeaders',
        'extraHeaders',
      ] as chrome.webRequest.OnSendHeadersOptions[]);
    }
  }

  // Extension API calls keep the worker running: it must be there for every Set-Cookie of a lane.
  if (patterns.length && heartbeat === undefined) heartbeat = setInterval(() => void beat(), 20_000);
  if (!patterns.length && heartbeat !== undefined) {
    clearInterval(heartbeat);
    heartbeat = undefined;
  }

  await syncContentScripts(patterns).catch(warn('lane page scripts'));
}

async function syncContentScripts(patterns: string[]): Promise<void> {
  const registered = await chrome.scripting
    .getRegisteredContentScripts({ ids: [...CONTENT_SCRIPTS] })
    .catch(() => [] as chrome.scripting.RegisteredContentScript[]);
  if (!patterns.length) {
    if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: registered.map((item) => item.id) });
    return;
  }
  const same =
    registered.length === CONTENT_SCRIPTS.length &&
    registered.every((item) => [...(item.matches ?? [])].sort().join(' ') === patterns.join(' '));
  if (same) return;
  if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: registered.map((item) => item.id) });
  const scripts = (fallback: boolean): chrome.scripting.RegisteredContentScript[] => [
    {
      id: CONTENT_SCRIPTS[0],
      js: ['content/lane-main.js'],
      matches: patterns,
      runAt: 'document_start',
      allFrames: true,
      world: 'MAIN' as chrome.scripting.ExecutionWorld,
      persistAcrossSessions: false,
      ...(fallback ? { matchOriginAsFallback: true } : {}),
    },
    {
      id: CONTENT_SCRIPTS[1],
      js: ['content/lane-relay.js'],
      matches: patterns,
      runAt: 'document_start',
      allFrames: true,
      persistAcrossSessions: false,
      ...(fallback ? { matchOriginAsFallback: true } : {}),
    },
  ];
  try {
    await chrome.scripting.registerContentScripts(scripts(true));
  } catch {
    // Chrome before 119 doesn't know matchOriginAsFallback for registered scripts.
    await chrome.scripting.registerContentScripts(scripts(false));
  }
}

async function beat(): Promise<void> {
  void chrome.runtime.getPlatformInfo().catch(() => undefined);
  for (const lane of allLanes()) {
    const kept = purgeExpired(lane.jar);
    if (kept.length !== lane.jar.length) {
      lane.jar = kept;
      void saveLanes();
      void syncRules(lane.token).catch(() => undefined);
    }
  }
}

// --- Cookies of lane requests --------------------------------------------------

function laneApp(lane: Lane, state: State): AppDef | undefined {
  return state.apps.find((item) => item.id === lane.appId);
}

let cachedApps: { at: number; apps: AppDef[] } = { at: 0, apps: [] };
async function appsNow(): Promise<AppDef[]> {
  if (Date.now() - cachedApps.at > 2000) cachedApps = { at: Date.now(), apps: (await readState()).apps };
  return cachedApps.apps;
}

/**
 * Requests of lane tabs that went out before the tab's rules were in place: they carried the
 * browser's cookies, so the cookies their responses set belong to the browser's account, never to
 * the lane's jar (oldest first; bounded).
 */
const uncovered = new Set<string>();

function onHeadersReceived(details: chrome.webRequest.OnHeadersReceivedDetails): undefined {
  const lane = laneOfTab(details.tabId);
  if (!lane) return undefined;
  if (uncovered.delete(details.requestId)) return undefined;
  const lines = (details.responseHeaders ?? [])
    .filter((header) => header.name.toLowerCase() === 'set-cookie' && header.value !== undefined)
    .flatMap((header) => header.value!.split('\n'));
  if (!lines.length) return undefined;
  void (async () => {
    const app = (await appsNow()).find((item) => item.id === lane.appId);
    const url = parseHttpUrl(details.url);
    if (!app || !url || !app.domains.some((domain) => hostMatchesDomain(url.hostname, domain))) return;
    takeCookies(lane, app, url, lines, 'header');
  })().catch(warn('lane cookies'));
  return undefined;
}

/** Stores cookies set for the lane and, when anything changed, updates its rules. */
function takeCookies(lane: Lane, app: AppDef, url: URL, lines: string[], from: 'header' | 'script'): boolean {
  let changed = false;
  for (const line of lines) {
    const parsed = parseCookie(line, url, from);
    if (!parsed) continue;
    if (!app.domains.some((domain) => hostMatchesDomain(parsed.cookie.domain.replace(/^\./, ''), domain))) continue;
    const next = storeCookie(lane.jar, parsed, from);
    if (next.changed) {
      lane.jar = next.jar;
      changed = true;
    }
  }
  if (changed) {
    void saveLanes();
    void syncRules(lane.token).catch(() => undefined);
    scheduleCapture(lane.token);
    // Set by a response: the pages' document.cookie learns it (their own writes they know already).
    if (from === 'header') announceCookies(lane);
  }
  return changed;
}

/** Tabs loaded again for a stale page, and when (at most once every few seconds per tab). */
const reloadedAt = new Map<number, number>();
const RELOAD_QUIET_MS = 5000;

function reloadOnce(tabId: number, run: () => Promise<unknown>): void {
  const last = reloadedAt.get(tabId) ?? 0;
  if (Date.now() - last < RELOAD_QUIET_MS) return;
  reloadedAt.set(tabId, Date.now());
  void run().catch(() => undefined);
}

/**
 * A page of a lane went out with other cookies than its lane's (its rules were a moment behind:
 * cookies set by a redirect, a tab that just joined the lane): load it again once the rules are in
 * step. Only GET pages: a form is never sent twice.
 */
function onSendHeaders(details: chrome.webRequest.OnSendHeadersDetails): void {
  const lane = laneOfTab(details.tabId);
  if (!lane) return;
  // Each hop of a redirect is judged on its own.
  const covered = coveredAt.get(details.tabId);
  if (covered === undefined || details.timeStamp < covered) {
    uncovered.add(details.requestId);
    if (uncovered.size > 2000) uncovered.delete(uncovered.values().next().value!);
  } else {
    uncovered.delete(details.requestId);
  }
  if (details.type !== 'main_frame' || details.frameId !== 0 || details.method !== 'GET') return;
  const url = parseHttpUrl(details.url);
  if (!url) return;
  const sent = details.requestHeaders?.find((header) => header.name.toLowerCase() === 'cookie')?.value ?? '';
  const expected = cookieHeader(lane.jar.filter((cookie) => cookieApplies(cookie, url)));
  if (sent === expected) return;
  const tabId = details.tabId;
  reloadOnce(tabId, async () => {
    await syncRules(lane.token);
    await chrome.tabs.update(tabId, { url: details.url });
  });
}

// --- Messages from the page relay (content/lane-relay.ts) ------------------------

type RelayMessage = { swapdeckLane: true; kind: string; url?: unknown; token?: unknown; line?: unknown };
/** The relay's answer: whether it was taken and, in a lane, what document.cookie reads at the sender's address. */
type RelayAnswer = { ok: boolean; cookies?: string };

function isRelayMessage(message: unknown): message is RelayMessage {
  return Boolean(message) && (message as { swapdeckLane?: unknown }).swapdeckLane === true;
}

async function onRelay(message: RelayMessage, sender: chrome.runtime.MessageSender): Promise<RelayAnswer> {
  // Only content scripts of this extension, in a tab, may speak for a page.
  if (sender.id !== chrome.runtime.id || !sender.tab?.id || typeof sender.url !== 'string') return { ok: false };
  await lanesReady();
  const tabId = sender.tab.id;
  const lane = laneOfTab(tabId);
  if (message.kind === 'hello' && sender.frameId === 0) {
    // A page of a lane that loaded without it (from the browser's cache, or before the tab joined).
    if (lane && message.token !== lane.token) {
      reloadOnce(tabId, async () => {
        await syncRules(lane.token);
        await chrome.tabs.reload(tabId, { bypassCache: true });
      });
    }
    return { ok: true };
  }
  if (!lane) return { ok: false };
  const url = parseHttpUrl(sender.url);
  const app = (await appsNow()).find((item) => item.id === lane.appId);
  if (!url || !app || !app.domains.some((domain) => hostMatchesDomain(url.hostname, domain))) return { ok: false };
  const answer = (): RelayAnswer => ({ ok: true, cookies: scriptCookies(lane.jar, url) });
  if (message.kind === 'cookie' && typeof message.line === 'string' && message.line.length <= 8192) {
    if (takeCookies(lane, app, url, [message.line], 'script')) await syncRules(lane.token).catch(() => undefined);
    return answer();
  }
  if (message.kind === 'flush') {
    // Set-Cookie of the response the page just got is read before this arrives: wait for its rules.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await syncRules(lane.token).catch(() => undefined);
    return answer();
  }
  if (message.kind === 'sync') return answer();
  if (message.kind === 'sw' && !lane.workerWarning) {
    lane.workerWarning = true;
    await saveLanes();
    return { ok: true };
  }
  return { ok: false };
}

const changeTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Tells a lane's pages that its cookies changed (they ask again what document.cookie reads). */
function announceCookies(lane: Lane): void {
  clearTimeout(changeTimers.get(lane.token));
  changeTimers.set(
    lane.token,
    setTimeout(() => {
      changeTimers.delete(lane.token);
      for (const tabId of lane.tabIds) {
        void chrome.tabs.sendMessage(tabId, { swapdeckLane: 'changed' }).catch(() => undefined);
      }
    }, 30),
  );
}

// --- Tabs ------------------------------------------------------------------------

async function groupTab(lane: Lane, tabId: number): Promise<void> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.pinned) return;
    const windowKey = String(tab.windowId);
    const known = lane.groups[windowKey];
    if (known !== undefined) {
      const group = await chrome.tabGroups.get(known).catch(() => null);
      if (group && group.windowId === tab.windowId) {
        if (tab.groupId !== known) await chrome.tabs.group({ tabIds: [tabId], groupId: known });
        return;
      }
    }
    const groupId = await chrome.tabs.group({ tabIds: [tabId], createProperties: { windowId: tab.windowId } });
    await chrome.tabGroups.update(groupId, { title: lane.title, color: tabGroupColor(lane.color), collapsed: false });
    lane.groups[windowKey] = groupId;
    void saveLanes();
  } catch {
    // Tab groups aren't available (a popup window) or the tab is gone: the lane works without one.
  }
}

async function ungroup(tabIds: number[]): Promise<void> {
  const tabs = await Promise.all(tabIds.map((tabId) => getTab(tabId)));
  const grouped = tabs.filter((tab) => tab && tab.groupId !== undefined && tab.groupId >= 0).map((tab) => tab!.id!);
  if (grouped.length) await chrome.tabs.ungroup(grouped as [number, ...number[]]).catch(() => undefined);
}

/** A tab a lane's page opened (a link to a new tab, window.open) belongs to the same lane. */
async function onTabCreated(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id === undefined || tab.openerTabId === undefined) return;
  // Only what the page opened (a link, window.open): not a new tab page the user opened next to it.
  const url = tab.pendingUrl || tab.url || '';
  if (url && !/^(https?:|about:blank)/.test(url)) return;
  await lanesReady();
  const lane = laneOfTab(tab.openerTabId);
  if (!lane || laneOfTab(tab.id)) return;
  addTabToLane(lane, tab.id);
  await saveLanes();
  await syncRules(lane.token).catch(() => undefined);
  await groupTab(lane, tab.id);
  await refreshLaneBadge(tab.id);
}

async function onTabRemoved(tabId: number): Promise<void> {
  await lanesReady();
  reloadedAt.delete(tabId);
  coveredAt.delete(tabId);
  welcomed.delete(tabId);
  const lane = removeTabFromLane(tabId);
  if (!lane || ending.has(lane.token)) return;
  await saveLanes();
  if (lane.tabIds.length) {
    await syncRules(lane.token).catch(() => undefined);
    return;
  }
  // Its last tab closed: save the session into the account, then let the lane go.
  await endLane(lane.token, { capture: lane.kind === 'account' }).catch(warn('closing a separate tab'));
}

async function onTabReplaced(added: number, removed: number): Promise<void> {
  await lanesReady();
  const lane = laneOfTab(removed);
  if (!lane) return;
  removeTabFromLane(removed);
  coveredAt.delete(removed);
  addTabToLane(lane, added);
  await saveLanes();
  await syncRules(lane.token).catch(() => undefined);
}

// --- Saving a lane's session -----------------------------------------------------

/** Reads the lane's session: its jar, and its storage from a page of the app (a lane tab when there is one). */
async function captureLane(lane: Lane, app: AppDef, allowStaging: boolean): Promise<Captured | null> {
  const tabs = await Promise.all(lane.tabIds.map((tabId) => getTab(tabId)));
  const onOrigin = tabs.find((tab) => tab?.status === 'complete' && originOf(tabUrl(tab) ?? '') === app.origin);
  const read = (tabId: number, own: boolean) =>
    runInTab(
      tabId,
      readPageStorage,
      [
        {
          local: true,
          // sessionStorage is one per tab: only a lane tab has the lane's.
          session: own && app.storage.sessionStorage,
          idb: app.storage.indexedDB,
          idbLimitBytes: IDB_LIMIT_BYTES,
          expectedOrigin: app.origin,
          lane: lane.token,
        },
      ],
      'ISOLATED',
      app.storage.indexedDB ? 60_000 : 10_000,
    );
  let page: PageReadResult | null = null;
  if (onOrigin?.id !== undefined) page = await read(onOrigin.id, true).catch(() => null);
  if (!page?.local && allowStaging) page = await withStagingTab(app, (tabId) => read(tabId, false)).catch(() => null);
  if (!page || page.origin !== app.origin || page.local === undefined || page.idbError) return null;

  const cookies = purgeExpired(lane.jar);
  const identity = detectIdentity(app.detector, { cookies, localStorage: page.local });
  const storage: WebStorageDump = {};
  if (app.storage.localStorage) storage.localStorage = page.local;
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

function statusFor(account: Account | undefined, identity: Identity | null, app: AppDef): Lane['status'] {
  const strong = identity?.confidence === 'strong' ? identity : null;
  if (strong) return !account || !hasIdentity(account) || sameIdentity(account, strong) ? 'ok' : 'other-person';
  return isSpecificDetector(app.detector) ? 'signed-out' : undefined;
}

const captures = new Map<string, Promise<unknown>>();

/**
 * Saves an account lane's session into its account, with the same rule as everywhere: only when
 * it is that account's person (or the account doesn't know who it is yet and learns it now).
 */
function saveLaneSession(token: string, allowStaging: boolean): Promise<void> {
  const previous = captures.get(token) ?? Promise.resolve();
  const run = previous.then(async () => {
    const lane = laneByToken(token);
    if (!lane || lane.kind !== 'account' || !lane.accountId) return;
    const state = await readState();
    const app = laneApp(lane, state);
    const account = state.accounts.find((item) => item.id === lane.accountId);
    if (!app || !account) return;
    const captured = await captureLane(lane, app, allowStaging);
    if (!captured) return;
    lane.identity = captured.identity ?? undefined;
    lane.status = statusFor(account, captured.identity, app);
    // As auto-sync: only a session recognised as signed in is saved (a site Swapdeck can't read
    // anyone on is saved as it is, like a switch would).
    if (captured.identity?.confidence !== 'strong' && app.detector.kind !== 'none') {
      await saveLanes();
      return;
    }
    const decision = decideSave({
      accounts: state.accounts.filter((item) => item.appId === app.id),
      activeId: account.id,
      detector: app.detector,
      identity: captured.identity,
      empty: isEmptySnapshot(captured.snapshot),
    });
    if (decision.kind === 'active') {
      await persist(app, captured, decision, translatorFor(state.settings), hasIdentity(account));
      lane.capturedAt = Date.now();
    }
    await saveLanes();
  });
  captures.set(
    token,
    run.catch(() => undefined),
  );
  return run;
}

const captureTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleCapture(token: string): void {
  const lane = laneByToken(token);
  if (!lane || lane.kind !== 'account') return;
  clearTimeout(captureTimers.get(token));
  const since = Date.now() - (lane.capturedAt ?? 0);
  const delay = Math.max(CAPTURE_DELAY_MS, CAPTURE_INTERVAL_MS - since);
  captureTimers.set(
    token,
    setTimeout(() => {
      captureTimers.delete(token);
      void readState().then((state) => {
        if (state.settings.autoSync) void saveLaneSession(token, false).catch(warn('saving a separate tab'));
      });
    }, delay),
  );
}

// --- Opening and ending lanes ------------------------------------------------------

/** Lanes being set up (their tabs show the switching page meanwhile: not watched). */
const seeding = new Set<string>();

async function rememberForRestore(): Promise<void> {
  const entries: LaneRestore[] = allLanes().map((lane) => ({
    token: lane.token,
    kind: lane.kind,
    appId: lane.appId,
    accountId: lane.accountId,
    title: lane.title,
  }));
  await chrome.storage.local.set({ [RESTORE_KEY]: entries }).catch(() => undefined);
}

async function noteLeftovers(appId: string, tokens: string[]): Promise<void> {
  if (!tokens.length) return;
  const raw = (await chrome.storage.local.get(LEFTOVERS_KEY))[LEFTOVERS_KEY];
  const list: Record<string, string[]> = raw && typeof raw === 'object' ? { ...(raw as Record<string, string[]>) } : {};
  list[appId] = [...new Set([...(Array.isArray(list[appId]) ? list[appId]! : []), ...tokens])].slice(-50);
  await chrome.storage.local.set({ [LEFTOVERS_KEY]: list });
}

/** Removes data of ended lanes from the app's origin, from a page there (scripts blocked or not). */
async function cleanLeftovers(app: AppDef, tabId: number): Promise<void> {
  const raw = (await chrome.storage.local.get(LEFTOVERS_KEY))[LEFTOVERS_KEY] as Record<string, unknown> | undefined;
  const live = allLanes()
    .filter((lane) => lane.appId === app.id)
    .map((lane) => lane.token);
  await runInTab(tabId, dropLaneData, [{ keep: live, expectedOrigin: app.origin }], 'ISOLATED', 10_000);
  if (raw && app.id in raw) {
    const { [app.id]: _done, ...rest } = raw;
    await chrome.storage.local.set({ [LEFTOVERS_KEY]: rest });
  }
}

function destination(app: AppDef, account: Account | undefined, state: State, url?: string): string {
  if (url && appForUrl([app], url)) return url;
  if (!account) return app.loginUrl ?? app.homeUrl;
  if (account.homeUrl) return account.homeUrl;
  if (state.settings.afterSwitch === 'last' && account.lastUrl && appForUrl([app], account.lastUrl))
    return account.lastUrl;
  return app.homeUrl;
}

export type OpenLaneRequest = {
  appId: string;
  /** null: a scratch lane (a fresh sign-in, forgotten when its tabs close unless saved). */
  accountId: string | null;
  /** The page to open (on the app's site); default: the account's start or last page. */
  url?: string;
  /** Open next to this tab. */
  besideTabId?: number;
  /** Open in the background. */
  background?: boolean;
  /** Turn these existing tabs into the lane (bringing lanes back after a restart). */
  adoptTabIds?: number[];
};

export type OpenLaneOutcome = { token: string; tabId: number; created: boolean };

/**
 * Opens a separate tab for an account (or a scratch one). An account that already has a lane gets
 * another tab in it. The account in use by the browser's own tabs doesn't need one (INVALID).
 */
export function openLane(request: OpenLaneRequest): Promise<OpenLaneOutcome> {
  // One at a time with the app's switches: "the account in use" can't change under it.
  return withAppLock(request.appId, () => openLaneNow(request), false);
}

async function openLaneNow(request: OpenLaneRequest): Promise<OpenLaneOutcome> {
  await lanesReady();
  const state = await readState();
  const app = findApp(state, request.appId);
  if (!(await hasAccess(app))) throw new SwapdeckError('NO_ACCESS', app.name);
  const t = translatorFor(state.settings);
  const account = request.accountId ? findAccount(state, request.accountId) : undefined;
  if (account && account.appId !== app.id) throw new SwapdeckError('INVALID');
  if (account && state.active[app.id] === account.id && !request.adoptTabIds)
    throw new SwapdeckError('INVALID', 'in-use');

  const existing = account ? laneOfAccount(account.id) : null;
  if (existing && !request.adoptTabIds) {
    const tabId = await newTab(existing, request);
    await navigateLaneTab(tabId, destination(app, account, state, request.url));
    return { token: existing.token, tabId, created: false };
  }

  const snapshot = account ? await loadSnapshot(account.id) : null;
  const scratchNumber = allLanes().filter((lane) => lane.kind === 'scratch' && lane.appId === app.id).length + 1;
  const lane: Lane = {
    token: newLaneToken(),
    kind: account ? 'account' : 'scratch',
    appId: app.id,
    accountId: account?.id ?? null,
    tabIds: [],
    jar: snapshot ? laneJar(snapshot.cookies, app.domains) : [],
    ruleIds: [],
    createdAt: Date.now(),
    title: laneTitle(account ? account.label : t('lane.scratchName', { n: scratchNumber }), app.name),
    color: account?.color ?? app.color,
    groups: {},
  };
  if (snapshot?.identity) lane.identity = snapshot.identity;
  if (account) lane.status = 'ok';

  seeding.add(lane.token);
  let tabId: number;
  /** Adopted tabs and the pages they showed (they leave the site while the lane is set up). */
  const adopted = new Map<number, string>();
  try {
    if (request.adoptTabIds?.length) {
      for (const id of request.adoptTabIds) {
        const url = tabUrl(await getTab(id));
        if (url) adopted.set(id, url);
      }
      if (!adopted.size) throw new SwapdeckError('NO_TAB');
      // Their pages (the browser's account) must never run with the lane's cookies: off the site first.
      for (const id of adopted.keys()) await toBlank(id);
      addLane(lane);
      for (const id of adopted.keys()) addTabToLane(lane, id);
      await saveLanes();
      await syncRules(lane.token);
      await refreshMachinery();
      if (snapshot && hasStorage(app, snapshot))
        await withStagingTab(app, (stagingId) => seedStorage(app, lane, stagingId, snapshot, false));
      for (const [id, url] of adopted) {
        await groupTab(lane, id);
        await chrome.tabs.update(id, { url }).catch(() => undefined);
      }
      tabId = [...adopted.keys()][0]!;
    } else {
      addLane(lane);
      tabId = await newTab(lane, request);
      await refreshMachinery();
      if (snapshot && hasStorage(app, snapshot)) {
        const ruleId = await blockPageScripts(tabId, app.domains);
        try {
          await openStaging(tabId, app);
          await seedStorage(app, lane, tabId, snapshot, true);
        } finally {
          await unblockPageScripts(ruleId);
        }
      }
    }
    await rememberForRestore();
    await update((draft) => {
      const used = account ? draft.accounts.find((item) => item.id === account.id) : undefined;
      if (used) used.lastUsedAt = Date.now();
      pushHistory(draft, {
        kind: 'lane',
        appId: app.id,
        appName: app.name,
        toId: account?.id ?? null,
        toLabel: account?.label ?? t('lane.scratchName', { n: scratchNumber }),
        ok: true,
      });
    });
  } catch (error) {
    seeding.delete(lane.token);
    if (adopted.size) {
      // Bringing a lane back failed: the tabs stay, ungrouped, on their pages with the browser's sign-in.
      await endLane(lane.token, { capture: false, keepTabs: true }).catch(() => undefined);
      await ungroup([...adopted.keys()]);
      for (const [id, url] of adopted) await chrome.tabs.update(id, { url }).catch(() => undefined);
    } else {
      // A tab opened for it goes with it.
      await endLane(lane.token, { capture: false }).catch(() => undefined);
    }
    throw error;
  }
  seeding.delete(lane.token);
  if (!request.adoptTabIds) await navigateLaneTab(tabId, destination(app, account, state, request.url));
  return { token: lane.token, tabId, created: true };
}

function hasStorage(app: AppDef, snapshot: Snapshot): boolean {
  const { localStorage, sessionStorage, indexedDB } = snapshot.storage;
  return (
    (app.storage.localStorage && Object.keys(localStorage ?? {}).length > 0) ||
    (app.storage.sessionStorage && Object.keys(sessionStorage ?? {}).length > 0) ||
    (app.storage.indexedDB && (indexedDB ?? []).length > 0)
  );
}

/** Writes the account's saved storage under the lane's names, on a page of the app's origin. */
async function seedStorage(app: AppDef, lane: Lane, tabId: number, snapshot: Snapshot, ownTab: boolean) {
  const result = await runInTab(
    tabId,
    writePageStorage,
    [
      {
        local: snapshot.storage.localStorage ?? {},
        session: snapshot.storage.sessionStorage ?? {},
        idb: snapshot.storage.indexedDB ?? [],
      },
      {
        local: app.storage.localStorage,
        // sessionStorage is the tab's own: only in the lane's own tab.
        session: ownTab && app.storage.sessionStorage,
        idb: app.storage.indexedDB,
        expectedOrigin: app.origin,
        lane: lane.token,
      },
    ],
    'ISOLATED',
    30_000,
  );
  if (result.origin !== app.origin) throw new SwapdeckError('STAGING_FAILED', result.origin);
  if (result.errors.length) console.warn('Swapdeck: some stored data could not be copied', result.errors);
  await cleanLeftovers(app, tabId).catch(() => undefined);
}

async function newTab(lane: Lane, request: OpenLaneRequest): Promise<number> {
  const beside = await getTab(request.besideTabId);
  const tab = await chrome.tabs.create({
    url: 'about:blank',
    active: !request.background,
    ...(beside ? { windowId: beside.windowId, index: beside.index + 1 } : {}),
  });
  const tabId = tab.id!;
  addTabToLane(lane, tabId);
  await saveLanes();
  await syncRules(lane.token);
  await groupTab(lane, tabId);
  return tabId;
}

async function navigateLaneTab(tabId: number, url: string): Promise<void> {
  welcomed.delete(tabId);
  await refreshLaneBadge(tabId);
  await navigateAndWait(tabId, url).catch(() => undefined);
}

export type EndLaneOptions = {
  /** Save the lane's session into its account first. */
  capture: boolean;
  /** Keep its tabs, as ordinary tabs again (else they are closed, or already gone). */
  keepTabs?: boolean;
  /** Send the kept tabs back to their pages (with the browser's own sign-in); else the caller does. */
  reload?: boolean;
};

/** Lanes being ended (their tabs closing don't end them a second time). */
const ending = new Set<string>();

/** Moves a tab off the site (its scripts stop) and resolves once it has, or after a few seconds. */
async function toBlank(tabId: number): Promise<void> {
  await navigateAndWait(tabId, 'about:blank', 5000).catch(() => undefined);
}

/**
 * Ends a lane: saves its session (when asked), then its pages leave — closed, or kept on a blank
 * page — before its rules go, so no page of the lane ever runs with the browser's own cookies; its
 * names are cleaned off the site. Returns the kept tabs and their pages when the caller sends them
 * back (a switch does, once the account is in place).
 */
export async function endLane(token: string, options: EndLaneOptions): Promise<ParkedTab[]> {
  await lanesReady();
  const lane = laneByToken(token);
  if (!lane || ending.has(token)) return [];
  ending.add(token);
  try {
    clearTimeout(captureTimers.get(token));
    captureTimers.delete(token);
    const state = await readState();
    const app = laneApp(lane, state);
    if (options.capture && app) await saveLaneSession(token, true).catch(warn('saving a separate tab'));
    const tabIds = [...lane.tabIds];

    const kept: ParkedTab[] = [];
    if (options.keepTabs) {
      for (const tabId of tabIds) {
        const tab = await getTab(tabId);
        const url = tabUrl(tab);
        if (!tab) continue;
        // sessionStorage is the tab's own and not renamed: the lane's mustn't stay for the browser's account.
        if (app?.storage.sessionStorage && url && originOf(url) === app.origin) {
          await runInTab(
            tabId,
            writePageStorage,
            [{ session: {} }, { local: false, session: true, idb: false, expectedOrigin: app.origin }],
            'ISOLATED',
            5000,
          ).catch(() => undefined);
        }
        await toBlank(tabId);
        if (url && /^https?:/.test(url)) kept.push({ id: tabId, url });
      }
    } else if (tabIds.length) {
      await chrome.tabs.remove(tabIds as [number, ...number[]]).catch(() => undefined);
    }

    dropLane(token);
    retired.set(token, [...lane.ruleIds]);
    lane.ruleIds = [];
    lane.tabIds = [];
    for (const tabId of tabIds) coveredAt.delete(tabId);
    await saveLanes();
    await syncRules(token).catch(() => undefined);
    await refreshMachinery();
    await rememberForRestore();

    if (app) {
      // Its names on the site go now, from any page of the site (or a hidden one): a scratch sign-in
      // must not outlive its tab, and the browser's own pages no longer hide the lane's names.
      const candidates = (await chrome.tabs.query({ url: matchPatterns(app) }).catch(() => [] as chrome.tabs.Tab[]))
        .filter((tab) => tab.id !== undefined && !tabIds.includes(tab.id) && !laneOfTab(tab.id))
        .filter((tab) => tab.status === 'complete' && originOf(tabUrl(tab) ?? '') === app.origin);
      const drop = (tabId: number) =>
        runInTab(tabId, dropLaneData, [{ tokens: [token], expectedOrigin: app.origin }], 'ISOLATED', 5000);
      let cleaned = false;
      for (const tab of candidates) {
        cleaned = await drop(tab.id!)
          .then((result) => result.origin === app.origin)
          .catch(() => false);
        if (cleaned) break;
      }
      if (!cleaned && (await hasAccess(app)))
        cleaned = await withStagingTab(app, drop)
          .then(() => true)
          .catch(() => false);
      if (!cleaned) await noteLeftovers(app.id, [token]).catch(() => undefined);
    }

    if (options.keepTabs) {
      await ungroup(tabIds);
      for (const tabId of tabIds) welcomed.delete(tabId);
      if (options.reload) {
        for (const tab of kept) await chrome.tabs.update(tab.id, { url: tab.url }).catch(() => undefined);
        return [];
      }
    }
    return kept;
  } finally {
    ending.delete(token);
  }
}

/**
 * Gives an account back to the browser's own tabs: its lane's session is saved and the lane ends.
 * Its tabs wait on a blank page; the switch sends them back once the account is in place.
 */
async function releaseLane(accountId: string): Promise<ParkedTab[] | null> {
  const lane = laneOfAccount(accountId);
  if (!lane) return null;
  return endLane(lane.token, { capture: true, keepTabs: true, reload: false });
}

/** Closes a lane's tabs, saving an account lane's session first. */
export async function closeLane(token: string): Promise<void> {
  const lane = laneByToken(token);
  if (!lane) throw new SwapdeckError('NOT_FOUND', token);
  await endLane(token, { capture: lane.kind === 'account' });
}

/** Brings a lane's first tab to the front. */
export async function focusLane(token: string): Promise<void> {
  const lane = laneByToken(token);
  const tabId = lane?.tabIds[0];
  if (tabId === undefined) throw new SwapdeckError('NOT_FOUND', token);
  const tab = await chrome.tabs.update(tabId, { active: true });
  if (tab?.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => undefined);
}

/** Lanes of an account or app that is being removed: their tabs stay, as ordinary tabs. */
export async function endLanesOf(filter: { appId?: string; accountId?: string } | 'all'): Promise<void> {
  await lanesReady();
  for (const lane of allLanes()) {
    const hit =
      filter === 'all' || (filter.accountId ? lane.accountId === filter.accountId : lane.appId === filter.appId);
    if (!hit) continue;
    await endLane(lane.token, { capture: false, keepTabs: true, reload: true }).catch(warn('ending a separate tab'));
  }
}

/**
 * Saves a scratch lane's sign-in as an account (the one it belongs to, or a new one; `target`
 * picks one, refused when it is someone else) and, when that account isn't in use elsewhere,
 * makes the lane that account's.
 */
export async function saveLane(token: string, target?: 'new' | string): Promise<SaveOutcome> {
  await lanesReady();
  const lane = laneByToken(token);
  if (!lane) throw new SwapdeckError('NOT_FOUND', token);
  const state = await readState();
  const app = findApp(state, lane.appId);
  const captured = await captureLane(lane, app, true);
  if (!captured || isEmptySnapshot(captured.snapshot)) throw new SwapdeckError('NO_SESSION');
  const accounts = state.accounts.filter((item) => item.appId === app.id);
  const strong = captured.identity?.confidence === 'strong' ? captured.identity : null;
  // A site that says who is signed in, and nobody is: nothing to save, into any account.
  if (!strong && isSpecificDetector(app.detector)) throw new SwapdeckError('NO_SESSION', 'signed-out');
  let decision: Exclude<SaveDecision, { kind: 'skip' }>;
  if (target === 'new') {
    decision = { kind: 'new' };
  } else if (target) {
    const account = findAccount(state, target);
    if (account.appId !== app.id) throw new SwapdeckError('INVALID');
    if (hasIdentity(account) && strong && !sameIdentity(account, strong))
      throw new SwapdeckError('INVALID', 'identity');
    decision = { kind: 'existing', accountId: account.id };
  } else if (lane.kind === 'account' && lane.accountId) {
    const decided = decideSave({
      accounts,
      activeId: lane.accountId,
      detector: app.detector,
      identity: captured.identity,
      empty: false,
    });
    if (decided.kind === 'skip') throw new SwapdeckError('NO_SESSION', decided.reason);
    decision = decided;
  } else {
    const owner = strong ? accounts.find((item) => sameIdentity(item, strong)) : undefined;
    decision = owner ? { kind: 'existing', accountId: owner.id } : { kind: 'new' };
  }
  const t = translatorFor(state.settings);
  const saved = await persist(app, captured, decision, t);
  const latest = await readState();
  const account = latest.accounts.find((item) => item.id === saved.accountId);
  if (
    account &&
    lane.kind === 'scratch' &&
    !laneOfAccount(account.id) &&
    latest.active[app.id] !== account.id &&
    laneByToken(token)
  ) {
    lane.kind = 'account';
    lane.accountId = account.id;
    lane.title = laneTitle(account.label, app.name);
    lane.color = account.color;
    lane.status = 'ok';
    lane.capturedAt = Date.now();
    if (captured.identity) lane.identity = captured.identity;
    for (const groupId of Object.values(lane.groups)) {
      await chrome.tabGroups
        .update(groupId, { title: lane.title, color: tabGroupColor(lane.color) })
        .catch(() => undefined);
    }
    await saveLanes();
    await rememberForRestore();
  }
  await update((draft) =>
    pushHistory(draft, {
      kind: 'save',
      appId: app.id,
      appName: app.name,
      toId: saved.accountId,
      toLabel: account?.label,
      ok: true,
    }),
  );
  for (const tabId of lane.tabIds) await refreshLaneBadge(tabId);
  return { ...saved, identity: captured.identity };
}

// --- Watching lane pages --------------------------------------------------------------

/** Lane tabs that got their "separate tab" note. */
const welcomed = new Set<number>();

async function laneToast(tabId: number, state: State, lane: Lane, app: AppDef, account: Account | undefined) {
  if (!state.settings.pageToasts) return;
  const t = translatorFor(state.settings);
  const active = state.accounts.find((item) => item.id === state.active[app.id]);
  const warning = lane.status === 'other-person' || lane.status === 'signed-out';
  const color = warning ? WARNING_COLOR : lane.color;
  const content = {
    title: warning
      ? lane.status === 'signed-out'
        ? t('lane.toastSignedOut', { label: account?.label ?? app.name })
        : t('lane.toastOtherPerson', { label: account?.label ?? app.name })
      : account
        ? t('lane.toastTitle', { label: account.label })
        : t('lane.toastScratchTitle', { app: app.name }),
    body: active ? t('lane.toastBody', { label: active.label }) : t('lane.toastBodyNone'),
    badge: warning ? '!' : account ? (account.emoji ?? initials(account.label)) : '+',
    badgeText: readableTextColor(color),
    color,
    tone: (warning ? 'warning' : 'info') as 'warning' | 'info',
    theme: state.settings.theme,
    closeLabel: t('common.close'),
    durationMs: 5200,
  };
  await runInTab(tabId, showToast, [content], 'ISOLATED', PAGE_SCRIPT_TIMEOUT_MS).catch(() => undefined);
}

async function markLaneTab(tabId: number, state: State, account: Account | undefined, lane: Lane) {
  const t = translatorFor(state.settings);
  const every = state.settings.pageRibbon === 'all';
  const content = !account
    ? every
      ? { tag: t('lane.tag'), label: lane.title, tone: 'calm' as const, color: lane.color }
      : null
    : account.important
      ? { tag: t('account.importantTag'), label: account.label, tone: 'important' as const }
      : every
        ? { tag: t('lane.tag'), label: account.label, tone: 'calm' as const, color: account.color }
        : null;
  if (!content && !state.accounts.some((item) => item.appId === lane.appId && item.important) && !every) return;
  await runInTab(tabId, showRibbon, [content], 'ISOLATED', PAGE_SCRIPT_TIMEOUT_MS).catch(() => undefined);
}

/** After a lane tab loads a page of its app: who is signed in there, keep its account's session fresh. */
export async function onLaneTabUpdated(tabId: number, info: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) {
  if (info.status !== 'complete' && !info.url) return;
  await lanesReady();
  const lane = laneOfTab(tabId);
  if (!lane || seeding.has(lane.token)) return;
  const state = await readState();
  const app = laneApp(lane, state);
  await refreshLaneBadge(tabId, state);
  const url = tabUrl(tab);
  if (!app || !url || !appForUrl([app], url) || info.status !== 'complete') return;
  const account = lane.accountId ? state.accounts.find((item) => item.id === lane.accountId) : undefined;

  let local: Record<string, string> | undefined;
  if (originOf(url) === app.origin) {
    const page = await runInTab(
      tabId,
      readPageStorage,
      [
        {
          local: true,
          session: false,
          idb: false,
          idbLimitBytes: 0,
          expectedOrigin: app.origin,
          lane: lane.token,
        },
      ],
      'ISOLATED',
      5000,
    ).catch(() => null);
    if (page?.origin === app.origin) local = page.local;
  }
  const identity = detectIdentity(app.detector, { cookies: lane.jar, localStorage: local });
  const readable = Boolean(identity) || local !== undefined || app.detector.kind === 'cookie';
  if (identity || readable) {
    lane.identity = identity ?? undefined;
    lane.status = statusFor(account, identity, app);
    await saveLanes();
  }

  if (account && lane.status === 'ok' && appForUrl([app], url)) {
    const recent = recentFor(app, url, tab.title);
    await update((draft) => {
      const item = draft.accounts.find((entry) => entry.id === account.id);
      if (!item) return;
      item.lastUrl = url;
      if (recent) item.recents = upsertRecent(item.recents, recent);
    });
    if (state.settings.autoSync && identity?.confidence === 'strong') scheduleCapture(lane.token);
  }

  if (!welcomed.has(tabId)) {
    welcomed.add(tabId);
    await laneToast(tabId, state, lane, app, account);
  }
  await markLaneTab(tabId, state, account, lane);
  await refreshLaneBadge(tabId, state);
}

/** The toolbar badge of a lane tab: its account's initials (or "+" for a scratch lane), in its color. */
export async function refreshLaneBadge(tabId: number, known?: State): Promise<boolean> {
  await lanesReady();
  const lane = laneOfTab(tabId);
  if (!lane) return false;
  const state = known ?? (await readState());
  const t = translatorFor(state.settings);
  const app = laneApp(lane, state);
  const account = lane.accountId ? state.accounts.find((item) => item.id === lane.accountId) : undefined;
  const warning = lane.status === 'other-person';
  const color = warning ? WARNING_COLOR : lane.color;
  const text = warning ? '!' : account ? initials(account.label) : '+';
  const title = t('badge.lane', { app: app?.name ?? '', account: account?.label ?? lane.title });
  try {
    await chrome.action.setBadgeText({ tabId, text: state.settings.badge ? text : '' });
    await chrome.action.setBadgeBackgroundColor({ tabId, color });
    await chrome.action.setBadgeTextColor?.({ tabId, color: readableTextColor(color) });
    await chrome.action.setTitle({ tabId, title });
  } catch {
    // The tab closed meanwhile.
  }
  return true;
}

// --- Start-up ------------------------------------------------------------------------------

/** Drops tabs that closed while the worker was stopped; ends lanes left without tabs. */
async function pruneClosedTabs(): Promise<void> {
  for (const lane of allLanes()) {
    const tabs = await Promise.all(lane.tabIds.map((tabId) => getTab(tabId)));
    const gone = lane.tabIds.filter((_, index) => !tabs[index]);
    for (const tabId of gone) removeTabFromLane(tabId);
    if (!lane.tabIds.length) await endLane(lane.token, { capture: lane.kind === 'account' }).catch(() => undefined);
    else if (gone.length) await syncRules(lane.token).catch(() => undefined);
  }
  await saveLanes();
}

/**
 * After Chrome (or the extension) restarts, lanes are gone but their tab groups come back. Account
 * lanes are opened again in their groups' tabs (from the account's saved session; with a locked
 * passphrase that can't be read, so the tabs are only ungrouped: they show the browser's own
 * sign-in, not under a name that would claim otherwise). Scratch lanes can't come back.
 */
export async function restoreLanes(): Promise<void> {
  await lanesReady();
  const raw = (await chrome.storage.local.get(RESTORE_KEY))[RESTORE_KEY];
  const live = new Set(allLanes().map((lane) => lane.token));
  const state = await readState();
  for (const entry of sanitizeRestore(raw)) {
    if (live.has(entry.token)) continue;
    await noteLeftovers(entry.appId, [entry.token]).catch(() => undefined);
    const groups = await chrome.tabGroups.query({ title: entry.title }).catch(() => [] as chrome.tabGroups.TabGroup[]);
    const tabIds: number[] = [];
    for (const group of groups) {
      const tabs = await chrome.tabs.query({ groupId: group.id }).catch(() => [] as chrome.tabs.Tab[]);
      for (const tab of tabs) if (tab.id !== undefined && !laneOfTab(tab.id)) tabIds.push(tab.id);
    }
    if (!tabIds.length) continue;
    const app = state.apps.find((item) => item.id === entry.appId);
    let restored = false;
    if (entry.kind === 'account' && app && entry.accountId && state.active[app.id] !== entry.accountId) {
      restored = await openLane({ appId: app.id, accountId: entry.accountId, adoptTabIds: tabIds })
        .then(() => true)
        .catch(() => false);
    }
    if (!restored) await ungroup(tabIds);
  }
  await rememberForRestore();
}

/** For the e2e build: what a browser restart leaves of lanes in memory (nothing). */
export async function forgetLanesForTest(): Promise<void> {
  resetLaneState();
  await chrome.storage.session.remove('sd:lanes');
  await lanesReady();
  welcomed.clear();
  reloadedAt.clear();
  await refreshMachinery();
}

/** Registers the lane listeners (call once, synchronously, when the worker starts). */
export function initLanes(): void {
  setLaneReleaser(releaseLane);
  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (!isRelayMessage(message)) return false;
    onRelay(message, sender).then(
      (answer) => sendResponse(answer),
      () => sendResponse({ ok: false }),
    );
    return true;
  });
  chrome.tabs.onCreated.addListener((tab) => void onTabCreated(tab).catch(warn('separate tab')));
  chrome.tabs.onRemoved.addListener((tabId) => void onTabRemoved(tabId).catch(warn('separate tab')));
  chrome.tabs.onReplaced.addListener(
    (added, removed) => void onTabReplaced(added, removed).catch(warn('separate tab')),
  );
  void lanesReady().then(pruneClosedTabs).then(removeOrphanRules).then(refreshMachinery).catch(warn('separate tabs'));
}
