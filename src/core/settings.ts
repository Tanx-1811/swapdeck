import type { Accent, Settings } from './types';

export const DEFAULT_SETTINGS: Settings = {
  language: 'auto',
  theme: 'system',
  afterSwitch: 'last',
  autoCapture: true,
  autoSync: true,
  pageToasts: true,
  confirmSwitch: false,
  badge: true,
  autoLockMinutes: 30,
  popupLayout: 'auto',
  actionOpens: 'popup',
  accent: 'son',
  vaultNudgeUntil: 0,
  guardUnsaved: true,
  lastBackupAt: 0,
  backupNudgeUntil: 0,
  syncList: false,
};

export const AUTO_LOCK_CHOICES = [0, 5, 15, 30, 60, 240] as const;

/** The accent choices, vermilion first (the default). */
export const ACCENTS: readonly Accent[] = ['son', 'ngoc', 'cham', 'vang'];

const time = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);

/** Settings from storage are untrusted: unknown keys are dropped, bad values fall back to defaults. */
export function parseSettings(value: unknown): Settings {
  const input = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const bool = (key: keyof Settings) =>
    typeof input[key] === 'boolean' ? (input[key] as boolean) : (DEFAULT_SETTINGS[key] as boolean);
  const lock = Number(input.autoLockMinutes);
  return {
    language: input.language === 'en' || input.language === 'vi' ? input.language : 'auto',
    theme: input.theme === 'light' || input.theme === 'dark' ? input.theme : 'system',
    afterSwitch: input.afterSwitch === 'same' || input.afterSwitch === 'home' ? input.afterSwitch : 'last',
    autoCapture: bool('autoCapture'),
    autoSync: bool('autoSync'),
    pageToasts: bool('pageToasts'),
    confirmSwitch: bool('confirmSwitch'),
    badge: bool('badge'),
    autoLockMinutes: Number.isInteger(lock) && lock >= 0 && lock <= 24 * 60 ? lock : DEFAULT_SETTINGS.autoLockMinutes,
    popupLayout: input.popupLayout === 'compact' || input.popupLayout === 'wide' ? input.popupLayout : 'auto',
    actionOpens: input.actionOpens === 'panel' ? 'panel' : 'popup',
    accent: ACCENTS.includes(input.accent as Accent) ? (input.accent as Accent) : 'son',
    vaultNudgeUntil: time(input.vaultNudgeUntil),
    guardUnsaved: bool('guardUnsaved'),
    lastBackupAt: time(input.lastBackupAt),
    backupNudgeUntil: time(input.backupNudgeUntil),
    syncList: bool('syncList'),
  };
}

/** How long "Later" hides the reminder to lock saved sessions. */
export const VAULT_NUDGE_SNOOZE_MS = 14 * 24 * 3600 * 1000;

/** Remind to lock saved sessions once two or more are saved and no passphrase is set. */
export function vaultNudgeDue(
  settings: Pick<Settings, 'vaultNudgeUntil'>,
  hasVault: boolean,
  savedSessions: number,
  now: number,
): boolean {
  return !hasVault && savedSessions >= 2 && now >= settings.vaultNudgeUntil;
}

const DAY_MS = 24 * 3600 * 1000;
/** A backup is suggested this long after the last one… */
export const BACKUP_NUDGE_AFTER_MS = 30 * DAY_MS;
/** …or, before any backup, this long after the first account was saved. */
export const FIRST_BACKUP_NUDGE_AFTER_MS = 3 * DAY_MS;
export const BACKUP_NUDGE_SNOOZE_MS = 14 * DAY_MS;

/** Suggest a backup when sessions are saved and the last backup is old (or there is none yet). */
export function backupNudgeDue(
  settings: Pick<Settings, 'lastBackupAt' | 'backupNudgeUntil'>,
  accounts: readonly { createdAt: number; capturedAt?: number }[],
  now: number,
): boolean {
  if (now < settings.backupNudgeUntil) return false;
  const saved = accounts.filter((account) => account.capturedAt);
  if (!saved.length) return false;
  if (settings.lastBackupAt) return now - settings.lastBackupAt >= BACKUP_NUDGE_AFTER_MS;
  return now - Math.min(...saved.map((account) => account.createdAt)) >= FIRST_BACKUP_NUDGE_AFTER_MS;
}
