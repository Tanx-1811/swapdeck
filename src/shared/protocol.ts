import type { GuardedPlan, UnsavedTab } from '../core/ask';
import type { LaneSummary } from '../core/lane-registry';
import type { Account, AppDef, DetectorSpec, Identity, Settings, StorageKinds, Workspace } from '../core/types';

/** Fields a page may set when adding or editing an app. */
export type AppInput = {
  presetId?: string;
  name: string;
  color: string;
  domains: string[];
  origin: string;
  homeUrl: string;
  loginUrl?: string;
  stagingPath: string;
  storage: StorageKinds;
  detector: DetectorSpec;
  recentPattern?: string;
  titleSuffix?: string;
};

export type AccountPatch = Partial<
  Pick<Account, 'label' | 'color' | 'icon' | 'note' | 'homeUrl' | 'important' | 'linkRules'>
> & {
  /** Optional fields to remove. */
  clear?: ('icon' | 'emoji' | 'note' | 'homeUrl' | 'important')[];
};

export type ProbeStatus =
  /** The page is signed in as the active account. */
  | 'match'
  /** Signed in as someone else than the active account. */
  | 'mismatch'
  /** Signed in as somebody not saved yet. */
  | 'unsaved'
  /** The site's detector finds nobody signed in. */
  | 'signed-out'
  /** No detector result to compare with. */
  | 'unknown';

export type Probe = {
  tabId: number | null;
  url: string | null;
  /** The configured app the tab belongs to. */
  appId: string | null;
  /** A built-in preset for the tab's site, when it isn't configured yet. */
  presetId: string | null;
  /** Whether Swapdeck may access the app's sites (host permission). */
  access: boolean;
  identity: Identity | null;
  activeId: string | null;
  /** The saved account the live identity belongs to. */
  matchId: string | null;
  status: ProbeStatus;
  /** The tab is a separate tab (its own sign-in, apart from the browser's). */
  lane?: LaneSummary;
};

export type SwitchOutcome = {
  /** Where the previous live session was saved, if anywhere. */
  saved: { accountId: string; created: boolean } | null;
  /** Why the previous session wasn't saved, when it wasn't. */
  skipped?: 'empty' | 'signed-out';
  tabId: number;
};

export type SaveOutcome = { accountId: string; created: boolean; identity: Identity | null };

/** Fields a page may set when creating or editing a workspace. */
export type WorkspaceInput = Pick<Workspace, 'name' | 'color' | 'members' | 'links'> &
  Partial<Pick<Workspace, 'icon' | 'emoji' | 'note'>>;

export type MemberResult = {
  appId: string;
  accountId: string;
  status: 'switched' | 'already' | 'no-session' | 'no-access' | 'failed';
  error?: ErrorCode;
};

export type WorkspaceOutcome = {
  workspaceId: string;
  results: MemberResult[];
  switched: number;
  /** Members that could not be switched (no access, no saved session, errors). */
  failed: number;
  /** Pages opened by "open workspace". */
  opened?: number;
};

export type BackupSummary = {
  encrypted: boolean;
  /** A file made to send one account or workspace: it can only be added (merge). */
  shared: boolean;
  createdAt: number;
  apps: number;
  accounts: number;
  sessions: number;
  workspaces: number;
};

type Api = {
  probe: { req: { tabId?: number }; res: Probe };
  switch: {
    req: { appId: string; accountId: string; tabId?: number; url?: string; focus?: boolean; background?: boolean };
    res: SwitchOutcome;
  };
  fresh: { req: { appId: string; tabId?: number; focus?: boolean }; res: SwitchOutcome };
  /** "Next/previous account" as the keyboard shortcut does it: asks on the page when needed. */
  cycle: { req: { tabId?: number; step: 1 | -1 }; res: 'done' | 'cancelled' | 'asked' };
  /** Tabs of these apps that may hold unsaved work (asked before a switch reloads them). */
  unsaved: { req: { appIds: string[] }; res: UnsavedTab[] };
  /** The confirmation window's answer for a switch asked for by a shortcut, the address bar or a menu. */
  'ask.answer': { req: { id: string; ok: boolean }; res: boolean };
  /** Chrome Sync of the list: take and send changes now. */
  'sync.now': { req: Record<string, never>; res: true };
  /** Turns sync off here and removes the list from Chrome Sync. */
  'sync.clear': { req: Record<string, never>; res: true };
  /** A switch as the shortcut, address bar and menus run it (asks on the page or in a window when needed). */
  'switch.guarded': { req: { plan: GuardedPlan }; res: 'done' | 'cancelled' | 'asked' };
  /** `target`: 'new' forces a new account, an account id updates that account; default: by identity. */
  save: { req: { appId: string; tabId?: number; target?: 'new' | string }; res: SaveOutcome };
  restorePrevious: { req: { accountId: string }; res: true };
  'app.add': { req: { app: AppInput }; res: AppDef };
  /** Adds several apps at once; presets already added are returned as they are. */
  'app.addMany': { req: { apps: AppInput[] }; res: AppDef[] };
  'app.update': { req: { id: string; patch: Partial<AppInput> }; res: AppDef };
  'app.remove': { req: { id: string }; res: true };
  'app.reorder': { req: { ids: string[] }; res: true };
  'account.update': { req: { id: string; patch: AccountPatch }; res: Account };
  'account.remove': { req: { id: string }; res: true };
  'account.reorder': { req: { appId: string; ids: string[] }; res: true };
  'account.pin': { req: { id: string; url: string; title: string }; res: Account };
  'account.unpin': { req: { id: string; pinId: string }; res: Account };
  'account.clearRecents': { req: { id: string }; res: Account };
  'settings.update': { req: { patch: Partial<Settings> }; res: Settings };
  'workspace.save': { req: { id?: string; workspace: WorkspaceInput }; res: Workspace };
  /** A workspace made of the accounts in use right now. */
  'workspace.fromActive': { req: { name: string }; res: Workspace };
  'workspace.remove': { req: { id: string }; res: true };
  'workspace.reorder': { req: { ids: string[] }; res: true };
  'workspace.switch': { req: { id: string; tabId?: number }; res: WorkspaceOutcome };
  'workspace.open': { req: { id: string; tabId?: number }; res: WorkspaceOutcome };
  'vault.create': { req: { passphrase: string }; res: true };
  'vault.unlock': { req: { passphrase: string }; res: true };
  'vault.lock': { req: Record<string, never>; res: true };
  'vault.change': { req: { current: string; next: string }; res: true };
  'vault.disable': { req: { passphrase: string }; res: true };
  'vault.reset': { req: Record<string, never>; res: true };
  'backup.export': {
    /** `only`: a file to send someone with just this account or workspace (and its sign-ins). */
    req: { password: string | null; includeSessions: boolean; only?: { accountId?: string; workspaceId?: string } };
    res: { text: string; unreadable: string[] };
  };
  'backup.inspect': { req: { text: string; password?: string }; res: BackupSummary };
  'backup.import': {
    req: { text: string; password?: string; mode: 'merge' | 'replace' };
    /** skipped: names of apps that can't be added (blocked sites); syncOff: a replace turned off sync of the list here. */
    res: { apps: number; accounts: number; sessions: number; workspaces: number; skipped: string[]; syncOff: boolean };
  };
  'history.clear': { req: Record<string, never>; res: true };
  /**
   * Opens an account (null: a scratch sign-in) in a separate tab, next to `tabId`; an account
   * already open in one gets another tab there. `url`: a page of the app to open.
   */
  'lane.open': {
    req: { appId: string; accountId: string | null; tabId?: number; url?: string; background?: boolean };
    res: { token: string; tabId: number; created: boolean };
  };
  /** Closes a separate tab's tabs (an account's session is saved first). */
  'lane.close': { req: { token: string }; res: true };
  'lane.focus': { req: { token: string }; res: true };
  /**
   * Saves a sign-in exported by another tool (cookie JSON, cookies.txt, Playwright storage state,
   * a Cookie header) as an account of the app.
   */
  'session.import': {
    req: { appId: string; text: string; target?: 'new' | string };
    res: SaveOutcome & { cookies: number; skipped: number };
  };
  /** Saves a separate tab's sign-in as an account (by who it is, or `target`). */
  'lane.save': { req: { token: string; target?: 'new' | string }; res: SaveOutcome };
  'data.wipe': { req: Record<string, never>; res: true };
};

export type RequestType = keyof Api;
export type RequestOf<T extends RequestType> = { type: T } & Api[T]['req'];
export type ResponseOf<T extends RequestType> = Api[T]['res'];
export type AnyRequest = { [T in RequestType]: RequestOf<T> }[RequestType];

export type ErrorCode =
  | 'NO_ACCESS'
  | 'LOCKED'
  | 'BAD_PASSPHRASE'
  | 'NOT_FOUND'
  | 'NO_SESSION'
  | 'NO_TAB'
  | 'STAGING_FAILED'
  | 'TIMEOUT'
  | 'BUSY'
  | 'INVALID'
  | 'BLOCKED_DOMAIN'
  | 'CORRUPT'
  | 'VAULT_EXISTS'
  | 'NO_VAULT'
  /** The site's databases (IndexedDB) are held open elsewhere: the switch was undone. */
  | 'STORAGE_BLOCKED'
  /** A failed switch couldn't put the previous session back: the site was signed out instead of mixed. */
  | 'ROLLBACK_FAILED'
  /** The switch stopped halfway (the extension restarted) and was undone when it started again. */
  | 'INTERRUPTED'
  /** History only: after the switch the site showed someone else than the chosen account. */
  | 'WRONG_ACCOUNT'
  | 'UNKNOWN';

export type Result<T> = { ok: true; data: T } | { ok: false; error: ErrorCode; detail?: string };

export class SwapdeckError extends Error {
  readonly code: ErrorCode;
  readonly detail?: string;
  constructor(code: ErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
    this.detail = detail;
  }
}

/** Sends a request to the service worker. Never throws: failures come back as `{ ok: false }`. */
export async function send<T extends RequestType>(
  type: T,
  payload: Api[T]['req'] = {} as Api[T]['req'],
): Promise<Result<ResponseOf<T>>> {
  try {
    const response = (await chrome.runtime.sendMessage({ type, ...payload })) as Result<ResponseOf<T>> | undefined;
    return response ?? { ok: false, error: 'UNKNOWN', detail: 'No response' };
  } catch (error) {
    return { ok: false, error: 'UNKNOWN', detail: error instanceof Error ? error.message : String(error) };
  }
}
