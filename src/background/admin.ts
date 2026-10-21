import {
  BACKUP_FORMAT,
  BackupError,
  openBackup,
  parseBackupFile,
  serializeBackup,
  type BackupPayload,
} from '../core/backup';
import {
  createVault,
  CryptoError,
  encryptWithPassword,
  isSealedBox,
  rekeyVault,
  seal,
  unlockVault,
  unseal,
} from '../core/crypto';
import { appForUrl, hostMatchesDomain, matchPatterns } from '../core/domains';
import { sameIdentity } from '../core/identity';
import { isBlockedDomain } from '../core/presets';
import { parseSettings } from '../core/settings';
import type { Account, AppDef, Settings, Snapshot, Workspace } from '../core/types';
import { ACCOUNT_COLORS, newId, nextColor, reorder } from '../core/util';
import {
  sanitizeAccount,
  sanitizeApp,
  sanitizeSnapshot,
  sanitizeStoredSnapshot,
  sanitizeWorkspace,
} from '../core/validate';
import { pruneMembers } from '../core/workspaces';
import {
  SwapdeckError,
  type AccountPatch,
  type AppInput,
  type BackupSummary,
  type WorkspaceInput,
} from '../shared/protocol';
import { KEYS, readState, SESSION_KEYS, type State } from '../shared/store';
import {
  allSnapshotKeys,
  exclusive,
  findAccount,
  getPrivateKey,
  readStoredSnapshot,
  removeSnapshots,
  sessionStats,
  setPrivateKey,
  storeSnapshot,
  unpackSnapshot,
  update,
} from './state';

export const AUTO_LOCK_ALARM = 'swapdeck-autolock';
const MIN_PASSPHRASE = 8;

// --- Apps --------------------------------------------------------------------

function overlapping(app: Pick<AppDef, 'id' | 'domains'>, others: readonly AppDef[]): AppDef | undefined {
  return others.find(
    (other) =>
      other.id !== app.id &&
      other.domains.some((a) => app.domains.some((b) => hostMatchesDomain(a, b) || hostMatchesDomain(b, a))),
  );
}

function checkApp(app: AppDef, others: readonly AppDef[]): void {
  const blocked = app.domains.find(isBlockedDomain);
  if (blocked) throw new SwapdeckError('BLOCKED_DOMAIN', blocked);
  if (!appForUrl([app], app.origin)) throw new SwapdeckError('INVALID', 'origin');
  const clash = overlapping(app, others);
  if (clash) throw new SwapdeckError('INVALID', `overlap:${clash.name}`);
}

export function addApp(input: AppInput): Promise<AppDef> {
  return update((draft) => {
    if (input.presetId) {
      const existing = draft.apps.find((app) => app.presetId === input.presetId);
      if (existing) return existing;
    }
    const app = sanitizeApp({
      ...input,
      id: newId('app'),
      order: draft.apps.reduce((max, item) => Math.max(max, item.order + 1), 0),
      createdAt: Date.now(),
    });
    if (!app) throw new SwapdeckError('INVALID');
    checkApp(app, draft.apps);
    draft.apps.push(app);
    return app;
  });
}

/** Adds several apps in one step (after one permission prompt for all of them). */
export function addApps(inputs: AppInput[]): Promise<AppDef[]> {
  return update((draft) => {
    const added: AppDef[] = [];
    for (const input of inputs) {
      const existing = input.presetId ? draft.apps.find((app) => app.presetId === input.presetId) : undefined;
      if (existing) {
        added.push(existing);
        continue;
      }
      const app = sanitizeApp({
        ...input,
        id: newId('app'),
        order: draft.apps.reduce((max, item) => Math.max(max, item.order + 1), 0),
        createdAt: Date.now(),
      });
      if (!app) throw new SwapdeckError('INVALID');
      checkApp(app, draft.apps);
      draft.apps.push(app);
      added.push(app);
    }
    return added;
  });
}

export function updateApp(id: string, patch: Partial<AppInput>): Promise<AppDef> {
  return update((draft) => {
    const index = draft.apps.findIndex((app) => app.id === id);
    if (index === -1) throw new SwapdeckError('NOT_FOUND', id);
    const current = draft.apps[index]!;
    const next = sanitizeApp({ ...current, ...patch, id, order: current.order, createdAt: current.createdAt });
    if (!next) throw new SwapdeckError('INVALID');
    if (patch.recentPattern === '') delete next.recentPattern;
    if (patch.loginUrl === '') delete next.loginUrl;
    checkApp(next, draft.apps);
    draft.apps[index] = next;
    return next;
  });
}

/** Host access no app needs any more is given back to the user. */
async function releaseUnusedAccess(removed: AppDef, remaining: readonly AppDef[]): Promise<void> {
  const stillNeeded = new Set(remaining.flatMap(matchPatterns));
  const origins = matchPatterns(removed).filter((pattern) => !stillNeeded.has(pattern));
  if (origins.length) await chrome.permissions.remove({ origins }).catch(() => false);
}

export async function removeApp(id: string): Promise<void> {
  const { removed, accountIds, remaining } = await update((draft) => {
    const app = draft.apps.find((item) => item.id === id);
    if (!app) throw new SwapdeckError('NOT_FOUND', id);
    const ids = draft.accounts.filter((account) => account.appId === id).map((account) => account.id);
    draft.apps = draft.apps.filter((item) => item.id !== id);
    draft.accounts = draft.accounts.filter((account) => account.appId !== id);
    delete draft.active[id];
    for (const workspace of draft.workspaces) workspace.members = pruneMembers(workspace.members, draft.accounts);
    return { removed: app, accountIds: ids, remaining: draft.apps };
  });
  await removeSnapshots(accountIds);
  await releaseUnusedAccess(removed, remaining);
}

export function reorderApps(ids: string[]): Promise<void> {
  return update((draft) => {
    draft.apps = reorder(draft.apps, ids);
  });
}

// --- Accounts ----------------------------------------------------------------

export function updateAccount(id: string, patch: AccountPatch): Promise<Account> {
  return update((draft) => {
    const index = draft.accounts.findIndex((account) => account.id === id);
    if (index === -1) throw new SwapdeckError('NOT_FOUND', id);
    const merged: Record<string, unknown> = { ...draft.accounts[index]! };
    for (const key of ['label', 'color', 'icon', 'note', 'homeUrl'] as const) {
      if (patch[key] !== undefined) merged[key] = typeof patch[key] === 'string' ? patch[key]!.trim() : patch[key];
    }
    if (patch.important !== undefined) merged.important = patch.important === true;
    const clearable = ['icon', 'emoji', 'note', 'homeUrl', 'important'];
    for (const key of patch.clear ?? []) if (clearable.includes(key)) delete merged[key];
    const next = sanitizeAccount(merged);
    if (!next) throw new SwapdeckError('INVALID');
    draft.accounts[index] = next;
    return next;
  });
}

export async function removeAccount(id: string): Promise<void> {
  await update((draft) => {
    const account = findAccount(draft, id);
    draft.accounts = draft.accounts.filter((item) => item.id !== id);
    if (draft.active[account.appId] === id) draft.active[account.appId] = null;
    for (const workspace of draft.workspaces) workspace.members = pruneMembers(workspace.members, draft.accounts);
  });
  await removeSnapshots([id]);
}

export function reorderAccounts(appId: string, ids: string[]): Promise<void> {
  return update((draft) => {
    const mine = draft.accounts.filter((account) => account.appId === appId);
    const others = draft.accounts.filter((account) => account.appId !== appId);
    draft.accounts = [...others, ...reorder(mine, ids)];
  });
}

export function pinPage(id: string, url: string, title: string): Promise<Account> {
  return update((draft) => {
    const account = findAccount(draft, id);
    const app = draft.apps.find((item) => item.id === account.appId);
    if (!app || !appForUrl([app], url)) throw new SwapdeckError('INVALID', 'url');
    if (!account.pins.some((pin) => pin.url === url)) {
      account.pins = [...account.pins, { id: newId('pin'), url, title: title.trim().slice(0, 200) || url }].slice(-30);
    }
    return account;
  });
}

export function unpinPage(id: string, pinId: string): Promise<Account> {
  return update((draft) => {
    const account = findAccount(draft, id);
    account.pins = account.pins.filter((pin) => pin.id !== pinId);
    return account;
  });
}

export function clearRecents(id: string): Promise<Account> {
  return update((draft) => {
    const account = findAccount(draft, id);
    account.recents = [];
    return account;
  });
}

// --- Workspaces --------------------------------------------------------------

export function saveWorkspace(id: string | undefined, input: WorkspaceInput): Promise<Workspace> {
  return update((draft) => {
    const index = id ? draft.workspaces.findIndex((workspace) => workspace.id === id) : -1;
    if (id && index === -1) throw new SwapdeckError('NOT_FOUND', id);
    const current = index >= 0 ? draft.workspaces[index] : undefined;
    const workspace = sanitizeWorkspace({
      ...current,
      ...input,
      id: current?.id ?? newId('ws'),
      order: current?.order ?? draft.workspaces.reduce((max, item) => Math.max(max, item.order + 1), 0),
      createdAt: current?.createdAt ?? Date.now(),
      switchCount: current?.switchCount ?? 0,
    });
    if (!workspace) throw new SwapdeckError('INVALID');
    if (!input.icon) delete workspace.icon;
    if (!input.emoji) delete workspace.emoji;
    if (!input.note) delete workspace.note;
    workspace.members = pruneMembers(workspace.members, draft.accounts);
    if (index >= 0) draft.workspaces[index] = workspace;
    else draft.workspaces.push(workspace);
    return workspace;
  });
}

/** A workspace with the account each app uses right now. */
export async function workspaceFromActive(name: string): Promise<Workspace> {
  const state = await readState();
  const members: Record<string, string> = {};
  for (const app of state.apps) {
    const accountId = state.active[app.id];
    if (accountId && state.accounts.some((account) => account.id === accountId)) members[app.id] = accountId;
  }
  if (Object.keys(members).length === 0) throw new SwapdeckError('NO_SESSION');
  return saveWorkspace(undefined, {
    name,
    color: ACCOUNT_COLORS[state.workspaces.length % ACCOUNT_COLORS.length]!,
    members,
    links: [],
  });
}

export function removeWorkspace(id: string): Promise<void> {
  return update((draft) => {
    draft.workspaces = draft.workspaces.filter((workspace) => workspace.id !== id);
  });
}

export function reorderWorkspaces(ids: string[]): Promise<void> {
  return update((draft) => {
    draft.workspaces = reorder(draft.workspaces, ids);
  });
}

export function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  return update((draft) => {
    draft.settings = parseSettings({ ...draft.settings, ...patch });
    return draft.settings;
  });
}

// --- Vault -------------------------------------------------------------------

export async function scheduleAutoLock(): Promise<void> {
  const state = await readState();
  await chrome.alarms.clear(AUTO_LOCK_ALARM);
  if (state.vault && state.settings.autoLockMinutes > 0 && (await getPrivateKey())) {
    await chrome.alarms.create(AUTO_LOCK_ALARM, { delayInMinutes: state.settings.autoLockMinutes });
  }
}

function checkPassphrase(passphrase: string): void {
  if (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE || passphrase.length > 1024) {
    throw new SwapdeckError('INVALID', 'passphrase');
  }
}

async function requireVault(): Promise<NonNullable<State['vault']>> {
  const state = await readState();
  if (!state.vault) throw new SwapdeckError('NO_VAULT');
  return state.vault;
}

export async function vaultCreate(passphrase: string): Promise<void> {
  checkPassphrase(passphrase);
  if ((await readState()).vault) throw new SwapdeckError('VAULT_EXISTS');
  const { meta, privateKey } = await createVault(passphrase);
  // Sealing every saved session and recording the vault happen as one step.
  await exclusive(async () => {
    const keys = await allSnapshotKeys();
    const stored = await chrome.storage.local.get(keys);
    const changes: Record<string, unknown> = { [KEYS.vault]: meta };
    for (const key of keys) {
      const value = sanitizeStoredSnapshot(stored[key]);
      if (value && 'plain' in value) changes[key] = { v: 1, sealed: await seal(value.plain, meta.publicKey) };
    }
    await chrome.storage.local.set(changes);
  });
  await setPrivateKey(privateKey);
  await scheduleAutoLock();
}

export async function vaultUnlock(passphrase: string): Promise<void> {
  const vault = await requireVault();
  try {
    await setPrivateKey(await unlockVault(vault, passphrase));
  } catch (error) {
    if (error instanceof CryptoError) throw new SwapdeckError('BAD_PASSPHRASE');
    throw error;
  }
  await scheduleAutoLock();
}

export async function vaultLock(): Promise<void> {
  await setPrivateKey(null);
  await chrome.alarms.clear(AUTO_LOCK_ALARM);
}

export async function vaultChange(current: string, next: string): Promise<void> {
  checkPassphrase(next);
  const vault = await requireVault();
  let privateKey: string;
  try {
    privateKey = await unlockVault(vault, current);
  } catch {
    throw new SwapdeckError('BAD_PASSPHRASE');
  }
  const meta = await rekeyVault(vault, privateKey, next);
  await update((draft) => {
    draft.vault = meta;
  });
  await setPrivateKey(privateKey);
  await scheduleAutoLock();
}

/** Turns encryption off: every sealed session is stored in the clear again. */
export async function vaultDisable(passphrase: string): Promise<void> {
  const vault = await requireVault();
  let privateKey: string;
  try {
    privateKey = await unlockVault(vault, passphrase);
  } catch {
    throw new SwapdeckError('BAD_PASSPHRASE');
  }
  await exclusive(async () => {
    const keys = await allSnapshotKeys();
    const stored = await chrome.storage.local.get(keys);
    const changes: Record<string, unknown> = {};
    const unreadable: string[] = [];
    for (const key of keys) {
      const value = stored[key] as { sealed?: unknown } | undefined;
      if (!value || !isSealedBox(value.sealed)) continue;
      // A session that can't be decrypted can never be used again: drop it rather than block.
      const plain = sanitizeSnapshot(await unseal<unknown>(value.sealed, privateKey).catch(() => null));
      if (plain) changes[key] = { v: 1, plain };
      else unreadable.push(key);
    }
    await chrome.storage.local.set(changes);
    await chrome.storage.local.remove([KEYS.vault, ...unreadable]);
  });
  await vaultLock();
}

/** "Forgot passphrase": deletes the vault and the sessions sealed with it. Accounts stay. */
export async function vaultReset(): Promise<void> {
  const removed = await exclusive(async () => {
    const keys = await allSnapshotKeys();
    const stored = await chrome.storage.local.get(keys);
    const sealed = keys.filter((key) => isSealedBox((stored[key] as { sealed?: unknown } | undefined)?.sealed));
    await chrome.storage.local.remove([...sealed, KEYS.vault]);
    return new Set(sealed.filter((key) => key.startsWith('sd:snap:')).map((key) => key.slice('sd:snap:'.length)));
  });
  await vaultLock();
  await update((draft) => {
    for (const account of draft.accounts) {
      if (!removed.has(account.id)) continue;
      delete account.capturedAt;
      delete account.stats;
    }
  });
}

// --- Backups -----------------------------------------------------------------

export async function exportBackup(password: string | null, includeSessions: boolean): Promise<string> {
  if (includeSessions && (!password || password.length < MIN_PASSPHRASE)) {
    throw new SwapdeckError('INVALID', 'password');
  }
  const state = await readState();
  const sessions: Record<string, Snapshot> = {};
  if (includeSessions) {
    for (const account of state.accounts) {
      const stored = await readStoredSnapshot(account.id);
      if (stored) sessions[account.id] = await unpackSnapshot(stored);
    }
  }
  const payload: BackupPayload = {
    apps: state.apps,
    accounts: state.accounts,
    active: state.active,
    settings: state.settings,
    sessions,
    workspaces: state.workspaces,
  };
  const encrypted = Boolean(password);
  return serializeBackup({
    format: BACKUP_FORMAT,
    version: 1,
    createdAt: Date.now(),
    encrypted,
    payload: encrypted ? await encryptWithPassword(JSON.stringify(payload), password!) : payload,
  });
}

async function readBackup(text: string, password?: string): Promise<{ payload: BackupPayload; createdAt: number }> {
  try {
    const file = parseBackupFile(text);
    return { payload: await openBackup(file, password), createdAt: file.createdAt };
  } catch (error) {
    if (error instanceof BackupError) {
      throw new SwapdeckError(error.code === 'INVALID' ? 'INVALID' : 'BAD_PASSPHRASE', error.code);
    }
    throw error;
  }
}

export async function inspectBackup(text: string, password?: string): Promise<BackupSummary> {
  const { payload, createdAt } = await readBackup(text, password);
  return {
    encrypted: Boolean(password),
    createdAt,
    apps: payload.apps.length,
    accounts: payload.accounts.length,
    sessions: Object.keys(payload.sessions).length,
    workspaces: payload.workspaces.length,
  };
}

/**
 * Imports a backup. "merge" adds what is missing: apps are matched by preset or
 * origin, accounts by identity (or label), and a session replaces a saved one
 * only when it is newer. "replace" swaps everything for the backup's contents.
 */
export async function importBackup(
  text: string,
  password: string | undefined,
  mode: 'merge' | 'replace',
): Promise<{ apps: number; accounts: number; sessions: number }> {
  const { payload } = await readBackup(text, password);
  if (mode === 'replace') await wipeData({ keepVault: true });

  const appIdMap = new Map<string, string>();
  const accountIdMap = new Map<string, string>();
  const sessionTargets: [string, Snapshot][] = [];
  const counts = await update((draft) => {
    let apps = 0;
    let accounts = 0;
    for (const app of payload.apps) {
      const existing = draft.apps.find(
        (item) => (app.presetId && item.presetId === app.presetId) || item.origin === app.origin,
      );
      if (existing) {
        appIdMap.set(app.id, existing.id);
        continue;
      }
      const copy: AppDef = { ...app, id: mode === 'replace' ? app.id : newId('app'), order: draft.apps.length };
      if (overlapping(copy, draft.apps) || copy.domains.some(isBlockedDomain)) continue;
      draft.apps.push(copy);
      appIdMap.set(app.id, copy.id);
      apps++;
    }
    for (const account of payload.accounts) {
      const appId = appIdMap.get(account.appId);
      if (!appId) continue;
      const siblings = draft.accounts.filter((item) => item.appId === appId);
      const identity = { id: account.identityId, email: account.email, name: account.name };
      const existing = siblings.find((item) =>
        account.identityId || account.email ? sameIdentity(item, identity) : item.label === account.label,
      );
      const session = payload.sessions[account.id];
      if (existing) {
        accountIdMap.set(account.id, existing.id);
        if (session && session.capturedAt > (existing.capturedAt ?? 0)) {
          sessionTargets.push([existing.id, session]);
          existing.capturedAt = session.capturedAt;
          existing.stats = sessionStats(session);
        }
        continue;
      }
      const copy: Account = {
        ...account,
        id: mode === 'replace' ? account.id : newId('acc'),
        appId,
        order: siblings.length,
        color: siblings.some((item) => item.color === account.color) ? nextColor(siblings) : account.color,
      };
      if (session) {
        copy.capturedAt = session.capturedAt;
        copy.stats = sessionStats(session);
      } else {
        delete copy.capturedAt;
        delete copy.stats;
      }
      draft.accounts.push(copy);
      accountIdMap.set(account.id, copy.id);
      if (session) sessionTargets.push([copy.id, session]);
      accounts++;
    }
    for (const [appId, accountId] of Object.entries(payload.active)) {
      const mappedApp = appIdMap.get(appId);
      if (!mappedApp || draft.active[mappedApp] !== undefined) continue;
      draft.active[mappedApp] = accountId === null ? null : (accountIdMap.get(accountId) ?? null);
    }
    if (mode === 'replace') draft.settings = payload.settings;
    let workspaces = 0;
    for (const workspace of payload.workspaces) {
      if (draft.workspaces.some((item) => item.name.toLowerCase() === workspace.name.toLowerCase())) continue;
      const members: Record<string, string> = {};
      for (const [appId, accountId] of Object.entries(workspace.members)) {
        const mappedApp = appIdMap.get(appId);
        const mappedAccount = accountIdMap.get(accountId);
        if (mappedApp && mappedAccount) members[mappedApp] = mappedAccount;
      }
      draft.workspaces.push({
        ...workspace,
        id: mode === 'replace' ? workspace.id : newId('ws'),
        members,
        order: draft.workspaces.length,
      });
      workspaces++;
    }
    return { apps, accounts, workspaces };
  });
  for (const [accountId, snapshot] of sessionTargets) await storeSnapshot(accountId, snapshot);
  return { ...counts, sessions: sessionTargets.length };
}

// --- Wipe --------------------------------------------------------------------

export async function wipeData(options: { keepVault?: boolean } = {}): Promise<void> {
  await exclusive(async () => {
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all).filter((key) => key.startsWith('sd:') && !(options.keepVault && key === KEYS.vault));
    await chrome.storage.local.remove(keys);
  });
  if (!options.keepVault) {
    await chrome.storage.session.remove([SESSION_KEYS.privateKey, SESSION_KEYS.live]);
    await chrome.alarms.clear(AUTO_LOCK_ALARM);
  } else {
    await chrome.storage.session.remove(SESSION_KEYS.live);
  }
}
