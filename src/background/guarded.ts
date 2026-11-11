import { askText, type AskText, type GuardedPlan, type PendingAsk, type UnsavedTab } from '../core/ask';
import { appForUrl } from '../core/domains';
import { cycleAccount } from '../core/decide';
import type { AppDef } from '../core/types';
import { importantTargets, pendingMembers } from '../core/workspaces';
import { readSessionInfo, readState, SESSION_KEYS, type State } from '../shared/store';
import { SwapdeckError } from '../shared/protocol';
import { hasAccess, switchTo, translatorFor } from './engine';
import { scheduleAutoLock } from './admin';
import { refreshMenus } from './menus';
import { askOnPage, unsavedWork } from './page-scripts';
import { activeTab, getTab, queryAppTabs, runInTab, tabUrl } from './tabs';
import { switchWorkspace } from './workspaces';

const ASK_TIMEOUT_MS = 25_000;
const ASK_WINDOW_MAX_AGE_MS = 5 * 60_000;
const PROBE_TIMEOUT_MS = 800;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([promise, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);
}

/**
 * Which of these tabs of the app have pages that may hold work a reload or a close would lose
 * (edited forms, text being typed, a page that warns before it is left). Discarded tabs have none.
 */
export async function unsavedInTabs(app: AppDef, tabs: readonly chrome.tabs.Tab[]): Promise<UnsavedTab[]> {
  const live = tabs.filter((tab) => tab.id !== undefined && !tab.discarded);
  const results = await Promise.all(
    live.map((tab) =>
      withTimeout(
        runInTab(tab.id!, unsavedWork, [], 'MAIN').catch(() => null),
        PROBE_TIMEOUT_MS,
      ).then((work) => ({ tab, work })),
    ),
  );
  const found: UnsavedTab[] = [];
  for (const { tab, work } of results) {
    if (work?.dirty && work.reason) {
      found.push({ tabId: tab.id!, appId: app.id, title: tab.title || app.name, reason: work.reason });
    }
  }
  return found;
}

/** Open tabs of these apps whose pages may hold work a switch would lose. */
export async function findUnsaved(appIds: readonly string[], known?: State): Promise<UnsavedTab[]> {
  const state = known ?? (await readState());
  if (!state.settings.guardUnsaved) return [];
  const found: UnsavedTab[] = [];
  for (const appId of new Set(appIds)) {
    const app = state.apps.find((item) => item.id === appId);
    if (!app || !(await hasAccess(app))) continue;
    found.push(...(await unsavedInTabs(app, await queryAppTabs(app))));
  }
  return found;
}

/** What a plan would need confirmed (null: go ahead). */
async function planText(plan: GuardedPlan, state: State): Promise<AskText | null> {
  const t = translatorFor(state.settings);
  const confirmAll = state.settings.confirmSwitch;
  if (plan.kind === 'workspace') {
    const workspace = state.workspaces.find((item) => item.id === plan.workspaceId);
    if (!workspace) throw new SwapdeckError('NOT_FOUND', plan.workspaceId);
    const { live } = await readSessionInfo();
    const appIds = pendingMembers(workspace, state.apps, state.accounts, state.active, live).map(([appId]) => appId);
    return askText(t, {
      kind: 'workspace',
      label: workspace.name,
      important: importantTargets(workspace, state.apps, state.accounts, state.active),
      unsaved: await findUnsaved(appIds, state),
      confirmAll,
    });
  }
  const app = state.apps.find((item) => item.id === plan.appId);
  if (!app) throw new SwapdeckError('NOT_FOUND', plan.appId);
  if (plan.kind === 'fresh') {
    return askText(t, {
      kind: 'fresh',
      label: app.name,
      app: app.name,
      important: [],
      unsaved: await findUnsaved([app.id], state),
      confirmAll,
    });
  }
  const account = state.accounts.find((item) => item.id === plan.accountId);
  if (!account) throw new SwapdeckError('NOT_FOUND', plan.accountId);
  // Re-opening the account in use still reloads the app's tabs: unsaved work is asked about too.
  const inUse = state.active[app.id] === account.id;
  return askText(t, {
    kind: 'account',
    label: account.label,
    app: app.name,
    important: account.important && !inUse ? [`${app.name}: ${account.label}`] : [],
    unsaved: await findUnsaved([app.id], state),
    confirmAll,
  });
}

async function execute(plan: GuardedPlan): Promise<void> {
  if (plan.kind === 'workspace') {
    await switchWorkspace(plan.workspaceId, plan.tabId);
  } else if (plan.kind === 'fresh') {
    await switchTo({ appId: plan.appId, accountId: null, kind: 'fresh', tabId: plan.tabId });
  } else {
    await switchTo({
      appId: plan.appId,
      accountId: plan.accountId,
      kind: 'switch',
      tabId: plan.tabId,
      ...(plan.focus ? { focus: true } : {}),
      ...(plan.url ? { url: plan.url } : {}),
      ...(plan.blankTab ? { adoptTab: true } : {}),
    });
  }
  await scheduleAutoLock();
}

/** A plan that was turned down: its blank tab (if any) goes, and the menus show what is really in use again. */
async function dropped(plan: GuardedPlan): Promise<void> {
  if (plan.kind === 'account' && plan.blankTab && plan.tabId !== undefined) {
    await chrome.tabs.remove(plan.tabId).catch(() => undefined);
  }
  refreshMenus();
}

/**
 * Runs a switch asked for without the popup, asking first when it would move to
 * an important account or reload tabs with unsaved work (or always, with "ask
 * before switching"): on the current page when Swapdeck may script it, else in
 * a small Swapdeck window.
 */
export async function runGuarded(plan: GuardedPlan): Promise<'done' | 'cancelled' | 'asked'> {
  const state = await readState();
  const text = await planText(plan, state);
  if (!text) {
    await execute(plan);
    return 'done';
  }
  const t = translatorFor(state.settings);
  const askTabId = plan.kind === 'account' && plan.askTabId !== undefined ? plan.askTabId : plan.tabId;
  const tab = askTabId !== undefined ? await getTab(askTabId) : await activeTab();
  if (tab?.id !== undefined) {
    const answer = await runInTab(
      tab.id,
      askOnPage,
      [{ ...text, cancel: t('common.cancel'), theme: state.settings.theme, timeoutMs: ASK_TIMEOUT_MS }],
      'ISOLATED',
      ASK_TIMEOUT_MS + 5000,
    ).catch(() => null);
    if (answer === true) {
      await execute(plan);
      return 'done';
    }
    if (answer === false) {
      await dropped(plan);
      return 'cancelled';
    }
  }
  // The page can't show it (another site, a browser page): ask in a small window instead.
  const pending: PendingAsk = { id: crypto.randomUUID(), plan, text, at: Date.now() };
  await chrome.storage.session.set({ [SESSION_KEYS.ask]: pending });
  await chrome.windows.create({
    url: chrome.runtime.getURL(`popup/popup.html?ask=${pending.id}`),
    type: 'popup',
    width: 460,
    height: 340,
    focused: true,
  });
  return 'asked';
}

/** The answer from the confirmation window. */
export async function answerAsk(id: string, ok: boolean): Promise<boolean> {
  const raw = (await chrome.storage.session.get(SESSION_KEYS.ask))[SESSION_KEYS.ask] as PendingAsk | undefined;
  if (!raw || raw.id !== id) return false;
  await chrome.storage.session.remove(SESSION_KEYS.ask);
  if (!ok) {
    await dropped(raw.plan);
    return true;
  }
  if (Date.now() - raw.at > ASK_WINDOW_MAX_AGE_MS) {
    await dropped(raw.plan);
    throw new SwapdeckError('INVALID', 'expired');
  }
  await execute(raw.plan);
  return true;
}

/** "Next account" / "Previous account" for the current tab's app, through the same checks. */
export async function cycleGuarded(tabId: number | undefined, step: 1 | -1) {
  const tab = tabId !== undefined ? await getTab(tabId) : await activeTab();
  const state = await readState();
  const app = appForUrl(state.apps, tabUrl(tab));
  if (!app) throw new SwapdeckError('NOT_FOUND', 'app');
  const next = cycleAccount(
    state.accounts.filter((account) => account.appId === app.id),
    state.active[app.id],
    step,
  );
  if (!next) throw new SwapdeckError('NO_SESSION');
  return runGuarded({ kind: 'account', appId: app.id, accountId: next.id, tabId: tab?.id });
}
