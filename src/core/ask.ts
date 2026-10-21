import type { Translate } from '../i18n/translate';

/** A tab whose page may hold work that a switch would lose (it is reloaded or left). */
export type UnsavedTab = {
  tabId: number;
  appId: string;
  title: string;
  /** warning: the page asks before being left · form: an edited form · typing: text being typed. */
  reason: 'warning' | 'form' | 'typing';
};

export type AskInput = {
  kind: 'account' | 'fresh' | 'workspace';
  /** The account's label, the workspace's name, or (fresh sign-in) the app's name. */
  label: string;
  /** The app's name (account and fresh switches). */
  app?: string;
  /** "App: account" for each important account the switch moves to (not those already in use). */
  important: string[];
  unsaved: UnsavedTab[];
  /** The "ask before every switch" setting. */
  confirmAll: boolean;
};

export type AskText = { title: string; body: string; items: string[]; confirm: string; danger: boolean };

/**
 * The one confirmation a switch needs, or null when it can go ahead: important
 * accounts first, then work that would be lost, then the "always ask" setting.
 * Shared by the popup, the manager, the on-page dialog and the confirmation window.
 */
export function askText(t: Translate, input: AskInput): AskText | null {
  const { kind, label, app = '', important, unsaved, confirmAll } = input;
  if (!important.length && !unsaved.length && !confirmAll) return null;
  const items = unsaved.map((tab) => `${tab.title} — ${t(`ask.reason.${tab.reason}`)}`);
  const lost = unsaved.length
    ? t(kind === 'workspace' ? 'ask.unsavedWorkspace' : kind === 'fresh' ? 'ask.unsavedFresh' : 'ask.unsavedBody', {
        app,
      })
    : '';
  const confirm = unsaved.length ? t('ask.switchAnyway') : t('apps.switchHere');
  const danger = important.length > 0 || unsaved.length > 0;
  if (important.length) {
    const why =
      kind === 'workspace'
        ? t('workspaces.confirmImportantBody', { list: important.join(', ') })
        : t('account.confirmImportantBody', { label, app });
    return {
      title: kind === 'workspace' ? t('workspaces.confirmTitle', { name: label }) : t('account.confirmImportantTitle'),
      body: lost ? `${why} ${lost}` : why,
      items,
      confirm,
      danger,
    };
  }
  if (unsaved.length) return { title: t('ask.unsavedTitle'), body: lost, items, confirm, danger };
  if (kind === 'workspace') {
    return {
      title: t('workspaces.confirmTitle', { name: label }),
      body: t('workspaces.confirmBody'),
      items,
      confirm,
      danger,
    };
  }
  if (kind === 'fresh') return null;
  return {
    title: t('account.switch', { label }),
    body: t('popup.confirmSwitch', { app, label }),
    items,
    confirm,
    danger,
  };
}

/** A switch asked for outside the popup and the manager: keyboard shortcut, address bar or menu. */
export type GuardedPlan =
  | { kind: 'account'; appId: string; accountId: string; tabId?: number; focus?: boolean }
  | { kind: 'fresh'; appId: string; tabId?: number }
  | { kind: 'workspace'; workspaceId: string; tabId?: number };

/** A confirmation waiting in the small Swapdeck window (when the page can't show it). */
export type PendingAsk = { id: string; plan: GuardedPlan; text: AskText; at: number };
