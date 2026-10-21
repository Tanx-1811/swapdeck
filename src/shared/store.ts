import { parseSettings } from '../core/settings';
import type { Account, ActiveMap, AppDef, HistoryEntry, Identity, Settings, VaultMeta, Workspace } from '../core/types';
import {
  sanitizeAccount,
  sanitizeActive,
  sanitizeApp,
  sanitizeHistory,
  sanitizeIdentity,
  sanitizeVault,
  sanitizeWorkspace,
} from '../core/validate';
import { byOrder } from '../core/util';

/**
 * Storage layout. chrome.storage.local (persistent, this device only):
 *   sd:apps, sd:accounts, sd:active, sd:settings, sd:history, sd:vault, sd:workspaces,
 *   sd:snap:<accountId> (saved session), sd:prev:<accountId> (the one before it).
 * chrome.storage.session (memory only, cleared when Chrome closes):
 *   sd:key (unlocked vault private key), sd:live (who is signed in, per app),
 *   sd:progress (a workspace switch under way).
 * Only the service worker writes; pages read and subscribe to changes.
 */
export const KEYS = {
  apps: 'sd:apps',
  accounts: 'sd:accounts',
  active: 'sd:active',
  settings: 'sd:settings',
  history: 'sd:history',
  vault: 'sd:vault',
  workspaces: 'sd:workspaces',
  meta: 'sd:meta',
} as const;

export const SESSION_KEYS = {
  privateKey: 'sd:key',
  live: 'sd:live',
  progress: 'sd:progress',
} as const;

/** A workspace switch in progress, shown in the popup. */
export type Progress = { workspaceId: string; total: number; done: number; current?: string };

export const snapKey = (accountId: string) => `sd:snap:${accountId}`;
export const prevSnapKey = (accountId: string) => `sd:prev:${accountId}`;

export type State = {
  apps: AppDef[];
  accounts: Account[];
  active: ActiveMap;
  settings: Settings;
  history: HistoryEntry[];
  vault: VaultMeta | null;
  workspaces: Workspace[];
};

/** Who was last seen signed in on each app, refreshed whenever one of its pages loads. */
export type LiveInfo = {
  identity: Identity | null;
  /** The detected identity doesn't belong to the active account. */
  mismatch: boolean;
  checkedAt: number;
  url?: string;
};
export type LiveMap = Record<string, LiveInfo>;

export function stateFromRaw(raw: Record<string, unknown>): State {
  const list = <T>(value: unknown, sanitize: (item: unknown) => T | null): T[] =>
    Array.isArray(value) ? value.map(sanitize).filter((item): item is T => item !== null) : [];
  return {
    apps: list(raw[KEYS.apps], sanitizeApp).sort(byOrder),
    accounts: list(raw[KEYS.accounts], sanitizeAccount).sort(byOrder),
    active: sanitizeActive(raw[KEYS.active]),
    settings: parseSettings(raw[KEYS.settings]),
    history: list(raw[KEYS.history], sanitizeHistory),
    vault: sanitizeVault(raw[KEYS.vault]),
    workspaces: list(raw[KEYS.workspaces], sanitizeWorkspace).sort(byOrder),
  };
}

export async function readState(): Promise<State> {
  const raw = await chrome.storage.local.get([
    KEYS.apps,
    KEYS.accounts,
    KEYS.active,
    KEYS.settings,
    KEYS.history,
    KEYS.vault,
    KEYS.workspaces,
  ]);
  return stateFromRaw(raw);
}

export function liveFromRaw(value: unknown): LiveMap {
  if (!value || typeof value !== 'object') return {};
  const out: LiveMap = {};
  for (const [appId, item] of Object.entries(value as Record<string, unknown>)) {
    if (!item || typeof item !== 'object') continue;
    const info = item as Record<string, unknown>;
    out[appId] = {
      identity: sanitizeIdentity(info.identity) ?? null,
      mismatch: info.mismatch === true,
      checkedAt: typeof info.checkedAt === 'number' ? info.checkedAt : 0,
      ...(typeof info.url === 'string' ? { url: info.url } : {}),
    };
  }
  return out;
}

function progressFromRaw(value: unknown): Progress | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (typeof item.workspaceId !== 'string' || typeof item.total !== 'number' || typeof item.done !== 'number')
    return null;
  return {
    workspaceId: item.workspaceId,
    total: item.total,
    done: item.done,
    ...(typeof item.current === 'string' ? { current: item.current } : {}),
  };
}

export type SessionInfo = { unlocked: boolean; live: LiveMap; progress: Progress | null };

export async function readSessionInfo(): Promise<SessionInfo> {
  const raw = await chrome.storage.session.get([SESSION_KEYS.privateKey, SESSION_KEYS.live, SESSION_KEYS.progress]);
  return {
    unlocked: typeof raw[SESSION_KEYS.privateKey] === 'string',
    live: liveFromRaw(raw[SESSION_KEYS.live]),
    progress: progressFromRaw(raw[SESSION_KEYS.progress]),
  };
}

const STATE_KEYS = new Set<string>(Object.values(KEYS));

/** Calls back whenever the state or the session info changes. */
export function subscribe(onState: () => void, onSession: () => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && Object.keys(changes).some((key) => STATE_KEYS.has(key))) onState();
    if (area === 'session') onSession();
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
