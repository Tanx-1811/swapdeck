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
};

export const AUTO_LOCK_CHOICES = [0, 5, 15, 30, 60, 240] as const;

/** The accent choices, vermilion first (the default). */
export const ACCENTS: readonly Accent[] = ['son', 'ngoc', 'cham', 'vang'];

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
    vaultNudgeUntil:
      typeof input.vaultNudgeUntil === 'number' && Number.isFinite(input.vaultNudgeUntil) && input.vaultNudgeUntil > 0
        ? input.vaultNudgeUntil
        : 0,
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
