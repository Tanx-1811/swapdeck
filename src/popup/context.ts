import { createContext, use } from 'react';
import type { Account, AppDef, Workspace } from '../core/types';
import type { Probe } from '../shared/protocol';
import type { Run } from '../options/context';
import type { Snapshot } from '../ui/hooks';

/** popup: the toolbar popup. panel: Chrome's side panel, which stays open next to the page. */
export type Mode = 'popup' | 'panel';

/**
 * Tests open the popup as a tab with ?tab=<id> for the tab it should act on,
 * and optionally ?app=<id> to start on an app's accounts.
 */
const params = new URLSearchParams(location.search);
export const TEST_TAB = params.has('tab') ? Number(params.get('tab')) : null;
export const START_APP = params.get('app');

export type SwitchOptions = {
  /** Page to open after switching. */
  url?: string;
  /** Open the app (in front) after switching, even when it isn't the current tab's app. */
  open?: boolean;
};

export type Switcher = {
  mode: Mode;
  data: Snapshot;
  probe: Probe;
  /** Re-check the current tab. */
  refresh: () => void;
  run: Run;
  pending: string | null;
  /** What is switching right now: `acc:<id>`, `fresh:<appId>` or `ws:<id>`. */
  busy: string | null;
  locked: boolean;
  /** Set while the vault must be unlocked before a switch can go on. */
  needsUnlock: boolean;
  unlocked: () => void;
  switchAccount: (app: AppDef, account: Account, options?: SwitchOptions) => Promise<void>;
  freshLogin: (app: AppDef) => Promise<void>;
  saveSession: (app: AppDef, target?: 'new' | string) => Promise<void>;
  switchWorkspace: (workspace: Workspace, open?: boolean) => Promise<void>;
  addPreset: (presetId: string) => Promise<void>;
  addSite: (url: string) => Promise<void>;
  openManager: (path?: string) => void;
  /** Closes the popup (never the side panel, nor the popup opened as a tab by tests). */
  close: () => void;
};

export const SwitcherContext = createContext<Switcher | null>(null);

export function useSwitcher(): Switcher {
  const value = use(SwitcherContext);
  if (!value) throw new Error('useSwitcher outside SwitcherContext');
  return value;
}
