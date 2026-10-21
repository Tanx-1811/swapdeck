import { appForUrl } from '../core/domains';
import { liveMembers, tabGroupColor } from '../core/workspaces';
import { SwapdeckError, type ErrorCode, type WorkspaceOutcome } from '../shared/protocol';
import { readState, SESSION_KEYS, type Progress } from '../shared/store';
import { hasAccess, switchTo } from './engine';
import { getPrivateKey, readStoredSnapshot, update } from './state';
import { activeTab, getTab, queryAppTabs, tabUrl } from './tabs';

async function setProgress(progress: Progress | null): Promise<void> {
  if (progress) await chrome.storage.session.set({ [SESSION_KEYS.progress]: progress });
  else await chrome.storage.session.remove(SESSION_KEYS.progress);
}

/**
 * Switches every app of a workspace to the workspace's account, one app after
 * another. The app of the tab the user is on switches first, in that tab; apps
 * without open tabs switch in a hidden tab, so nothing new opens. One failing
 * app doesn't stop the others; the outcome says what happened to each.
 */
export async function switchWorkspace(id: string, tabId?: number): Promise<WorkspaceOutcome> {
  const state = await readState();
  const workspace = state.workspaces.find((item) => item.id === id);
  if (!workspace) throw new SwapdeckError('NOT_FOUND', id);
  const members = liveMembers(workspace, state.apps, state.accounts);
  if (members.length === 0) throw new SwapdeckError('NO_SESSION');
  const pending = members.filter(([appId, accountId]) => state.active[appId] !== accountId);

  // Fail before changing anything when restoring would need the passphrase.
  if (state.vault && !(await getPrivateKey())) {
    for (const [, accountId] of pending) {
      const stored = await readStoredSnapshot(accountId);
      if (stored && 'sealed' in stored) throw new SwapdeckError('LOCKED');
    }
  }

  const tab = tabId !== undefined ? await getTab(tabId) : await activeTab();
  const currentApp = appForUrl(state.apps, tabUrl(tab));
  const ordered = [...pending].sort(([a], [b]) => Number(b === currentApp?.id) - Number(a === currentApp?.id));
  const results: WorkspaceOutcome['results'] = members
    .filter(([appId, accountId]) => state.active[appId] === accountId)
    .map(([appId, accountId]) => ({ appId, accountId, status: 'already' as const }));

  let done = 0;
  // Apps with no open tab all swap in one hidden tab, closed at the end.
  let hiddenTabId: number | undefined;
  try {
    for (const [appId, accountId] of ordered) {
      const app = state.apps.find((item) => item.id === appId)!;
      const account = state.accounts.find((item) => item.id === accountId)!;
      await setProgress({ workspaceId: id, total: ordered.length, done, current: app.name });
      if (!account.capturedAt) {
        results.push({ appId, accountId, status: 'no-session' });
      } else if (!(await hasAccess(app))) {
        results.push({ appId, accountId, status: 'no-access' });
      } else {
        try {
          if (hiddenTabId === undefined && (await queryAppTabs(app)).length === 0) {
            hiddenTabId = (await chrome.tabs.create({ url: 'about:blank', active: false })).id;
          }
          await switchTo({
            appId,
            accountId,
            kind: 'switch',
            background: true,
            via: workspace.name,
            ...(hiddenTabId !== undefined ? { hiddenTabId } : {}),
            ...(app.id === currentApp?.id && tab?.id !== undefined ? { tabId: tab.id } : {}),
          });
          results.push({ appId, accountId, status: 'switched' });
        } catch (error) {
          const code: ErrorCode = error instanceof SwapdeckError ? error.code : 'UNKNOWN';
          results.push({ appId, accountId, status: 'failed', error: code });
        }
      }
      done++;
    }
  } finally {
    if (hiddenTabId !== undefined) await chrome.tabs.remove(hiddenTabId).catch(() => undefined);
    await setProgress(null);
  }

  await update((draft) => {
    const item = draft.workspaces.find((entry) => entry.id === id);
    if (!item) return;
    item.lastUsedAt = Date.now();
    item.switchCount += 1;
  });
  return {
    workspaceId: id,
    results,
    switched: results.filter((result) => result.status === 'switched').length,
    failed: results.filter((result) => result.status !== 'switched' && result.status !== 'already').length,
  };
}

/** Switches the workspace, then opens its pages together in a named tab group. */
export async function openWorkspace(id: string, tabId?: number): Promise<WorkspaceOutcome> {
  const outcome = await switchWorkspace(id, tabId);
  const state = await readState();
  const workspace = state.workspaces.find((item) => item.id === id);
  if (!workspace?.links.length) return outcome;
  const window = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
  const tabIds: number[] = [];
  for (const [index, link] of workspace.links.entries()) {
    const created = await chrome.tabs.create({
      url: link.url,
      active: index === 0,
      ...(window?.id !== undefined ? { windowId: window.id } : {}),
    });
    if (created.id !== undefined) tabIds.push(created.id);
  }
  if (tabIds.length) {
    try {
      const groupId = await chrome.tabs.group({ tabIds: tabIds as [number, ...number[]] });
      await chrome.tabGroups.update(groupId, { title: workspace.name, color: tabGroupColor(workspace.color) });
    } catch {
      // Tab groups aren't available (e.g. in a popup-type window): the tabs stay open anyway.
    }
  }
  return { ...outcome, opened: tabIds.length };
}
