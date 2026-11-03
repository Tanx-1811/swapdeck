import type { Account, AppDef, Settings, VaultMeta, Workspace } from './types';

/**
 * The "getting started" checklist on the overview: what a new user should do
 * once, each step done when the data says so (nothing to tick by hand).
 */
export type OnboardingStepId = 'app' | 'accounts' | 'workspace' | 'lock' | 'backup' | 'sync';
export type OnboardingStep = { id: OnboardingStepId; done: boolean; optional: boolean };

export function onboardingSteps(state: {
  apps: readonly Pick<AppDef, 'id'>[];
  accounts: readonly Pick<Account, 'appId' | 'capturedAt'>[];
  workspaces: readonly Pick<Workspace, 'id'>[];
  vault: VaultMeta | null;
  settings: Pick<Settings, 'lastBackupAt' | 'syncList'>;
}): OnboardingStep[] {
  const saved = (appId: string) => state.accounts.filter((item) => item.appId === appId && item.capturedAt).length;
  return [
    { id: 'app', done: state.apps.length > 0, optional: false },
    { id: 'accounts', done: state.apps.some((app) => saved(app.id) >= 2), optional: false },
    { id: 'workspace', done: state.workspaces.length > 0, optional: false },
    { id: 'lock', done: Boolean(state.vault), optional: false },
    { id: 'backup', done: state.settings.lastBackupAt > 0, optional: false },
    { id: 'sync', done: state.settings.syncList, optional: true },
  ];
}

/** Shown until every required step is done, unless put away. */
export function onboardingVisible(steps: readonly OnboardingStep[], hidden: boolean): boolean {
  return !hidden && steps.some((step) => !step.done && !step.optional);
}
