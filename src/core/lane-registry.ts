import { LANE_TOKEN } from './lanes';
import type { CookieRecord, Identity } from './types';
import { color, isId, sanitizeCookie, sanitizeIdentity } from './validate';
import { record } from './util';

/**
 * A lane: the tabs where one account (or a scratch sign-in) is used apart from the rest of the
 * browser, with its own cookie jar. Kept by the worker in session storage (`sd:lanes`): memory
 * only, gone when Chrome closes.
 */
export type Lane = {
  token: string;
  /** account: a saved account's session; scratch: a fresh, throwaway sign-in. */
  kind: 'account' | 'scratch';
  appId: string;
  accountId: string | null;
  tabIds: number[];
  jar: CookieRecord[];
  ruleIds: number[];
  createdAt: number;
  /** The name of the lane's tab groups. */
  title: string;
  color: string;
  /** Tab group per window. */
  groups: Record<string, number>;
  /** When the lane's session was last saved into its account. */
  capturedAt?: number;
  /** Who the lane's pages show signed in, last time one loaded. */
  identity?: Identity;
  /** ok: the account's person; other-person: someone else signed in; signed-out: nobody. */
  status?: 'ok' | 'other-person' | 'signed-out';
  /** A service worker of the site answers this lane's pages (its requests use the browser's sign-in). */
  workerWarning?: boolean;
};

export type LaneRegistry = {
  lanes: Record<string, Lane>;
  /** Tab id → lane token. */
  tabs: Record<string, string>;
};

/** What pages need to know about a lane (no cookies). */
export type LaneSummary = Pick<
  Lane,
  'token' | 'kind' | 'appId' | 'accountId' | 'tabIds' | 'title' | 'color' | 'status' | 'identity' | 'workerWarning'
>;

const STATUSES = new Set(['ok', 'other-person', 'signed-out']);
const isTabId = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;

export function emptyRegistry(): LaneRegistry {
  return { lanes: record(), tabs: record() };
}

export function sanitizeLane(value: unknown): Lane | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (typeof item.token !== 'string' || !LANE_TOKEN.test(item.token)) return null;
  if (!isId(item.appId)) return null;
  const kind = item.kind === 'scratch' ? 'scratch' : 'account';
  const accountId = kind === 'account' && isId(item.accountId) ? item.accountId : null;
  if (kind === 'account' && !accountId) return null;
  const groups: Record<string, number> = record();
  if (item.groups && typeof item.groups === 'object') {
    for (const [windowId, groupId] of Object.entries(item.groups as Record<string, unknown>)) {
      if (/^\d+$/.test(windowId) && isTabId(groupId)) groups[windowId] = groupId;
    }
  }
  const lane: Lane = {
    token: item.token,
    kind,
    appId: item.appId,
    accountId,
    tabIds: Array.isArray(item.tabIds) ? [...new Set(item.tabIds.filter(isTabId))] : [],
    jar: Array.isArray(item.jar)
      ? item.jar.map(sanitizeCookie).filter((cookie): cookie is CookieRecord => cookie !== null)
      : [],
    ruleIds: Array.isArray(item.ruleIds) ? item.ruleIds.filter(isTabId) : [],
    createdAt: typeof item.createdAt === 'number' ? item.createdAt : 0,
    title: typeof item.title === 'string' ? item.title.slice(0, 80) : '',
    color: color(item.color, '#6f665b'),
    groups,
  };
  if (typeof item.capturedAt === 'number') lane.capturedAt = item.capturedAt;
  const identity = sanitizeIdentity(item.identity);
  if (identity) lane.identity = identity;
  if (typeof item.status === 'string' && STATUSES.has(item.status)) lane.status = item.status as Lane['status'];
  if (item.workerWarning === true) lane.workerWarning = true;
  return lane;
}

export function sanitizeRegistry(value: unknown): LaneRegistry {
  const registry = emptyRegistry();
  if (!value || typeof value !== 'object') return registry;
  const raw = value as { lanes?: unknown; tabs?: unknown };
  if (raw.lanes && typeof raw.lanes === 'object') {
    for (const item of Object.values(raw.lanes as Record<string, unknown>)) {
      const lane = sanitizeLane(item);
      if (lane) registry.lanes[lane.token] = lane;
    }
  }
  // The tab map is rebuilt from the lanes: a tab belongs to at most one lane.
  for (const lane of Object.values(registry.lanes)) {
    lane.tabIds = lane.tabIds.filter((tabId) => !registry.tabs[tabId]);
    for (const tabId of lane.tabIds) registry.tabs[tabId] = lane.token;
  }
  return registry;
}

export function summarize(lane: Lane): LaneSummary {
  const summary: LaneSummary = {
    token: lane.token,
    kind: lane.kind,
    appId: lane.appId,
    accountId: lane.accountId,
    tabIds: [...lane.tabIds],
    title: lane.title,
    color: lane.color,
  };
  if (lane.status) summary.status = lane.status;
  if (lane.identity) summary.identity = lane.identity;
  if (lane.workerWarning) summary.workerWarning = true;
  return summary;
}

/** A lane's tab group title: the account (or "Scratch n") and the app. */
export function laneTitle(label: string, appName: string): string {
  const text = `${label} · ${appName}`;
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
}

/** Lanes to bring back after Chrome restarts: which group held which account's tabs. */
export type LaneRestore = {
  token: string;
  kind: 'account' | 'scratch';
  appId: string;
  accountId: string | null;
  title: string;
};

export function sanitizeRestore(value: unknown): LaneRestore[] {
  if (!Array.isArray(value)) return [];
  const out: LaneRestore[] = [];
  for (const item of value.slice(0, 100)) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    if (typeof raw.token !== 'string' || !LANE_TOKEN.test(raw.token) || !isId(raw.appId)) continue;
    if (typeof raw.title !== 'string' || !raw.title) continue;
    const kind = raw.kind === 'scratch' ? 'scratch' : 'account';
    const accountId = isId(raw.accountId) ? raw.accountId : null;
    if (kind === 'account' && !accountId) continue;
    out.push({ token: raw.token, kind, appId: raw.appId, accountId, title: raw.title.slice(0, 80) });
  }
  return out;
}
