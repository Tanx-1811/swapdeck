import { decryptWithPassword, isPasswordBox, type PasswordBox } from './crypto';
import { parseSettings } from './settings';
import type { Account, ActiveMap, AppDef, Settings, Snapshot, Workspace } from './types';
import { record } from './util';
import { sanitizeAccount, sanitizeActive, sanitizeApp, sanitizeSnapshot, sanitizeWorkspace } from './validate';
import { pruneMembers } from './workspaces';

export const BACKUP_FORMAT = 'swapdeck-backup';

export type BackupPayload = {
  apps: AppDef[];
  accounts: Account[];
  active: ActiveMap;
  settings: Settings;
  /** Saved sessions by account id; empty when exported without sessions. */
  sessions: Record<string, Snapshot>;
  workspaces: Workspace[];
  /**
   * Made to send to someone: only ever added to what is there (never "replace"). Inside the
   * payload — the encrypted, authenticated part — so it can't be taken off without the password.
   */
  shared?: boolean;
};

export type BackupFile = {
  format: typeof BACKUP_FORMAT;
  version: 1;
  createdAt: number;
  encrypted: boolean;
  /**
   * Made to send one account or workspace to someone (also said inside the payload, which is what
   * counts: this outer copy isn't authenticated and only lets a file be told apart before it is opened).
   */
  shared?: boolean;
  payload: BackupPayload | PasswordBox;
};

export class BackupError extends Error {
  readonly code: 'INVALID' | 'BAD_PASSPHRASE' | 'NEEDS_PASSWORD';
  constructor(code: 'INVALID' | 'BAD_PASSPHRASE' | 'NEEDS_PASSWORD') {
    super(code);
    this.code = code;
  }
}

export function serializeBackup(file: BackupFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

export function parseBackupFile(text: string): BackupFile {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new BackupError('INVALID');
  }
  if (!value || typeof value !== 'object') throw new BackupError('INVALID');
  const file = value as Record<string, unknown>;
  if (file.format !== BACKUP_FORMAT || file.version !== 1) throw new BackupError('INVALID');
  const encrypted = file.encrypted === true;
  if (encrypted && !isPasswordBox(file.payload)) throw new BackupError('INVALID');
  if (!encrypted && (!file.payload || typeof file.payload !== 'object')) throw new BackupError('INVALID');
  return {
    format: BACKUP_FORMAT,
    version: 1,
    createdAt: typeof file.createdAt === 'number' ? file.createdAt : 0,
    encrypted,
    ...(file.shared === true ? { shared: true } : {}),
    payload: file.payload as BackupPayload | PasswordBox,
  };
}

/** Cleans an untrusted payload; accounts must belong to an app in the same backup. */
export function sanitizePayload(value: unknown): BackupPayload {
  if (!value || typeof value !== 'object') throw new BackupError('INVALID');
  const input = value as Record<string, unknown>;
  const apps = (Array.isArray(input.apps) ? input.apps : [])
    .map(sanitizeApp)
    .filter((app): app is AppDef => app !== null);
  const appIds = new Set(apps.map((app) => app.id));
  const accounts = (Array.isArray(input.accounts) ? input.accounts : [])
    .map(sanitizeAccount)
    .filter((account): account is Account => account !== null && appIds.has(account.appId));
  const accountIds = new Set(accounts.map((account) => account.id));
  const sessions = record<Snapshot>();
  if (input.sessions && typeof input.sessions === 'object') {
    for (const [id, raw] of Object.entries(input.sessions as Record<string, unknown>)) {
      const snapshot = accountIds.has(id) ? sanitizeSnapshot(raw) : null;
      if (snapshot) sessions[id] = snapshot;
    }
  }
  const workspaces = (Array.isArray(input.workspaces) ? input.workspaces : [])
    .map(sanitizeWorkspace)
    .filter((workspace): workspace is Workspace => workspace !== null)
    .map((workspace) => ({ ...workspace, members: pruneMembers(workspace.members, accounts) }));
  const active = sanitizeActive(input.active);
  for (const [appId, accountId] of Object.entries(active)) {
    if (!appIds.has(appId) || (accountId !== null && !accountIds.has(accountId))) delete active[appId];
  }
  return {
    apps,
    accounts,
    active,
    settings: parseSettings(input.settings),
    sessions,
    workspaces,
    ...(input.shared === true ? { shared: true } : {}),
  };
}

/**
 * Whether a file was made to send to someone, and so may only be merged: said by the payload (the
 * part the password authenticates) or by the outer flag. Taking the outer flag off a shared file,
 * or changing it, never makes it replaceable.
 */
export function isShared(file: Pick<BackupFile, 'shared'>, payload: Pick<BackupPayload, 'shared'>): boolean {
  return file.shared === true || payload.shared === true;
}

/**
 * An account as a file sent to someone carries it: what it is and how it is set up (label, the
 * person, colour and symbol, pins, start page, link rules, the important flag) — never what the
 * sender did with it (note, recent pages, last page, use counts, when it was used, saved or found
 * signed out, the size of the session). The session itself travels next to it.
 */
export function shareableAccount(account: Account): Account {
  const {
    note: _note,
    recents: _recents,
    lastUrl: _lastUrl,
    lastUsedAt: _lastUsedAt,
    switchCount: _switchCount,
    capturedAt: _capturedAt,
    expiredAt: _expiredAt,
    stats: _stats,
    ...kept
  } = account;
  return { ...kept, recents: [], switchCount: 0 };
}

/** A workspace as a file sent to someone carries it: without its note, use counts or other computers' members. */
export function shareableWorkspace(workspace: Workspace): Workspace {
  const {
    note: _note,
    lastUsedAt: _lastUsedAt,
    switchCount: _switchCount,
    foreignMembers: _foreignMembers,
    ...kept
  } = workspace;
  return { ...kept, switchCount: 0 };
}

export async function openBackup(file: BackupFile, password?: string): Promise<BackupPayload> {
  if (!file.encrypted) return sanitizePayload(file.payload);
  if (!password) throw new BackupError('NEEDS_PASSWORD');
  let text: string;
  try {
    text = await decryptWithPassword(file.payload as PasswordBox, password);
  } catch {
    throw new BackupError('BAD_PASSPHRASE');
  }
  try {
    return sanitizePayload(JSON.parse(text));
  } catch {
    throw new BackupError('INVALID');
  }
}
