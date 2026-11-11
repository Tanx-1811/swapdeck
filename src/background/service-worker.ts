import { appForUrl } from '../core/domains';
import { KEYS, readState } from '../shared/store';
import { AUTO_LOCK_ALARM, scheduleAutoLock, vaultLock } from './admin';
import { refreshAllBadges, refreshBadge } from './badge';
import { recoverInterruptedSwaps, saveLive } from './engine';
import { cycleGuarded, runGuarded } from './guarded';
import { openLinkAs } from './links';
import { clearStaleRules } from './guard';
import { parseMenuId, refreshMenus, scheduleMenuRebuild } from './menus';
import { setupOmnibox } from './omnibox';
import { listen } from './router';
import { activeTab, getTab, tabUrl } from './tabs';
import { syncNow } from './sync';
import { forgetLanesForTest, initLanes, onLaneTabUpdated, openLane, restartWorkerForTest, restoreLanes } from './lanes';
import { onTabUpdated } from './watcher';
import { workspaceStatus } from '../core/workspaces';

listen();
setupOmnibox();
initLanes();

declare const __SWAPDECK_E2E__: boolean;
// The e2e build lets tests run what Chrome only does on a restart (bringing separate tabs back).
if (__SWAPDECK_E2E__)
  Object.assign(globalThis, { swapdeckTest: { restoreLanes, forgetLanesForTest, restartWorkerForTest } });
// No switch can be running while the worker starts: rules left by an interrupted one go, and a
// swap it left halfway (journal in session storage) is undone.
void clearStaleRules()
  .then(recoverInterruptedSwaps)
  .catch((error: unknown) => console.warn('Swapdeck: start-up recovery failed', error));

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
  await runGuarded({ kind: 'workspace', workspaceId: next.id, tabId });
}

chrome.runtime.onInstalled.addListener((details) => {
  void clearStaleRules();
  // An update or reload drops the separate tabs' rules: bring them back in their tab groups.
  if (details.reason === 'update') void restoreLanes().catch((error: unknown) => console.warn('Swapdeck:', error));
  void applyActionBehavior();
  scheduleMenuRebuild(0);
  void chrome.storage.local.set({ [KEYS.meta]: { schema: 1 } });
  if (details.reason === 'install') openManager('?welcome=1');
});

chrome.runtime.onStartup.addListener(() => {
  void clearStaleRules();
  void restoreLanes().catch((error: unknown) => console.warn('Swapdeck: separate tabs not restored', error));
  void applyActionBehavior();
  scheduleMenuRebuild(0);
  void scheduleAutoLock();
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  void onTabUpdated(tabId, info, tab);
  void onLaneTabUpdated(tabId, info, tab).catch((error: unknown) => console.warn('Swapdeck: separate tab', error));
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void getTab(tabId).then((tab) => tab && refreshBadge(tab));
});

// Chrome Sync of the list (off unless turned on in Settings).
let syncTimer: ReturnType<typeof setTimeout> | undefined;
let syncDue = 0;
/** Syncs after `delayMs`, or sooner when a sync is already due sooner. */
function syncSoon(delayMs: number): void {
  const due = Date.now() + delayMs;
  if (syncTimer !== undefined && syncDue <= due) return;
  clearTimeout(syncTimer);
  syncDue = due;
  syncTimer = setTimeout(() => {
    syncTimer = undefined;
    void syncNow().catch((error: unknown) => console.warn('Swapdeck: sync failed', error));
  }, delayMs);
}
syncSoon(3000);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && Object.keys(changes).some((key) => key.startsWith('sd1:'))) syncSoon(1000);
  if (area === 'local' && [KEYS.apps, KEYS.accounts, KEYS.workspaces].some((key) => key in changes)) syncSoon(4000);
  if (area === 'local' && KEYS.settings in changes) {
    const before = (changes[KEYS.settings]?.oldValue as { syncList?: boolean } | undefined)?.syncList;
    const after = (changes[KEYS.settings]?.newValue as { syncList?: boolean } | undefined)?.syncList;
    if (after && !before) syncSoon(0);
  }

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
  // Chrome has already moved the radio check: put it back when the switch doesn't happen.
  const settle = (result: 'done' | 'cancelled' | 'asked') => {
    if (result !== 'done') refreshMenus();
  };
  const failed = (error: unknown) => {
    refreshMenus();
    report(error);
  };
  if (action.kind === 'switch') {
    void runGuarded({ kind: 'account', appId: action.appId, accountId: action.accountId, tabId }).then(settle, failed);
  } else if (action.kind === 'linkAs') {
    if (info.linkUrl) void openLinkAs(action.appId, action.accountId, info.linkUrl, tabId).catch(report);
  } else if (action.kind === 'lane' || action.kind === 'laneLink' || action.kind === 'scratch') {
    // A separate tab never reloads or switches the browser's other tabs: nothing to ask first.
    void openLane({
      appId: action.appId,
      accountId: action.kind === 'scratch' ? null : action.accountId,
      besideTabId: tabId,
      ...(action.kind === 'laneLink' && info.linkUrl ? { url: info.linkUrl } : {}),
    }).catch(report);
  } else if (action.kind === 'fresh') {
    void runGuarded({ kind: 'fresh', appId: action.appId, tabId }).catch(report);
  } else if (action.kind === 'save') {
    void saveLive(action.appId, tabId).catch(report);
  } else if (action.kind === 'workspace') {
    void runGuarded({ kind: 'workspace', workspaceId: action.workspaceId, tabId }).then(settle, failed);
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
    await cycleGuarded(tab?.id, command === 'switch-next' ? 1 : -1).catch(report);
    return;
  }
  if (command === 'switch-workspace-next') {
    await nextWorkspace(tab?.id).catch(report);
    return;
  }
  if (command === 'open-scratch-tab') {
    const state = await readState();
    const app = appForUrl(state.apps, tabUrl(tab));
    if (app) await openLane({ appId: app.id, accountId: null, besideTabId: tab?.id }).catch(report);
    return;
  }
  if (command === 'new-login') {
    const state = await readState();
    const app = appForUrl(state.apps, tabUrl(tab));
    if (app) await runGuarded({ kind: 'fresh', appId: app.id, tabId: tab?.id }).catch(report);
  }
});
