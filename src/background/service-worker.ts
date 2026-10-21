import { appForUrl } from '../core/domains';
import { KEYS, readState } from '../shared/store';
import { AUTO_LOCK_ALARM, scheduleAutoLock, vaultLock } from './admin';
import { refreshAllBadges, refreshBadge } from './badge';
import { cycle, saveLive, switchTo } from './engine';
import { clearStaleRules } from './guard';
import { parseMenuId, scheduleMenuRebuild } from './menus';
import { setupOmnibox } from './omnibox';
import { listen } from './router';
import { activeTab, getTab, tabUrl } from './tabs';
import { onTabUpdated } from './watcher';
import { switchWorkspace } from './workspaces';
import { workspaceStatus } from '../core/workspaces';

listen();
setupOmnibox();
// No switch can be running while the worker starts: rules left by an interrupted one go.
void clearStaleRules();

function openManager(path = ''): void {
  void chrome.tabs.create({ url: chrome.runtime.getURL(`options/options.html${path}`) });
}

/** The toolbar button opens the popup, or the side panel when the user prefers it. */
async function applyActionBehavior(): Promise<void> {
  const { settings } = await readState();
  const panel = settings.actionOpens === 'panel';
  await chrome.action.setPopup({ popup: panel ? '' : 'popup/popup.html' }).catch(() => undefined);
  await chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: panel }).catch(() => undefined);
}

function openSidePanel(windowId: number | undefined): void {
  // Must run straight from the user's gesture: no awaits before this call.
  if (windowId !== undefined) void chrome.sidePanel.open({ windowId }).catch(() => undefined);
}

/** Switches to the workspace after the one fully in use (or the first). */
async function nextWorkspace(tabId: number | undefined): Promise<void> {
  const state = await readState();
  const usable = state.workspaces.filter(
    (workspace) => workspaceStatus(workspace, state.apps, state.accounts, state.active).total > 0,
  );
  if (!usable.length) return;
  const current = usable.findIndex(
    (workspace) => workspaceStatus(workspace, state.apps, state.accounts, state.active).state === 'active',
  );
  const next = usable[(current + 1) % usable.length]!;
  await switchWorkspace(next.id, tabId);
  await scheduleAutoLock();
}

chrome.runtime.onInstalled.addListener((details) => {
  void clearStaleRules();
  void applyActionBehavior();
  scheduleMenuRebuild(0);
  void chrome.storage.local.set({ [KEYS.meta]: { schema: 1 } });
  if (details.reason === 'install') openManager('?welcome=1');
});

chrome.runtime.onStartup.addListener(() => {
  void clearStaleRules();
  void applyActionBehavior();
  scheduleMenuRebuild(0);
  void scheduleAutoLock();
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  void onTabUpdated(tabId, info, tab);
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void getTab(tabId).then((tab) => tab && refreshBadge(tab));
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (
    area === 'local' &&
    [KEYS.apps, KEYS.accounts, KEYS.active, KEYS.settings, KEYS.workspaces].some((key) => key in changes)
  ) {
    scheduleMenuRebuild();
  }
  if (area === 'local' && KEYS.settings in changes) void applyActionBehavior();
  if (
    (area === 'local' && [KEYS.apps, KEYS.accounts, KEYS.active, KEYS.settings].some((key) => key in changes)) ||
    area === 'session'
  ) {
    void refreshAllBadges();
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTO_LOCK_ALARM) void vaultLock();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const action = parseMenuId(info.menuItemId);
  if (!action) return;
  if (action.kind === 'panel') {
    openSidePanel(tab?.windowId);
    return;
  }
  const tabId = tab?.id;
  const report = (error: unknown) => console.warn('Swapdeck: menu action failed', error);
  if (action.kind === 'switch') {
    void switchTo({ appId: action.appId, accountId: action.accountId, kind: 'switch', tabId })
      .then(scheduleAutoLock)
      .catch(report);
  } else if (action.kind === 'fresh') {
    void switchTo({ appId: action.appId, accountId: null, kind: 'fresh', tabId }).catch(report);
  } else if (action.kind === 'save') {
    void saveLive(action.appId, tabId).catch(report);
  } else if (action.kind === 'workspace') {
    void switchWorkspace(action.workspaceId, tabId).then(scheduleAutoLock).catch(report);
  } else {
    openManager(action.appId ? `#/apps/${action.appId}` : '');
  }
});

chrome.commands.onCommand.addListener(async (command, commandTab) => {
  if (command === 'open-side-panel') {
    openSidePanel(commandTab?.windowId);
    return;
  }
  const tab = commandTab ?? (await activeTab());
  const report = (error: unknown) => console.warn(`Swapdeck: ${command} failed`, error);
  if (command === 'open-manager') {
    openManager();
    return;
  }
  if (command === 'switch-next' || command === 'switch-previous') {
    await cycle(tab?.id, command === 'switch-next' ? 1 : -1)
      .then(scheduleAutoLock)
      .catch(report);
    return;
  }
  if (command === 'switch-workspace-next') {
    await nextWorkspace(tab?.id).catch(report);
    return;
  }
  if (command === 'new-login') {
    const state = await readState();
    const app = appForUrl(state.apps, tabUrl(tab));
    if (app) await switchTo({ appId: app.id, accountId: null, kind: 'fresh', tabId: tab?.id }).catch(report);
  }
});
