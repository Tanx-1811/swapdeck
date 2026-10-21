import { SwapdeckError, type AnyRequest, type ErrorCode, type Result } from '../shared/protocol';
import {
  addApp,
  addApps,
  clearRecents,
  exportBackup,
  importBackup,
  inspectBackup,
  pinPage,
  removeAccount,
  removeApp,
  removeWorkspace,
  reorderAccounts,
  reorderApps,
  reorderWorkspaces,
  scheduleAutoLock,
  unpinPage,
  updateAccount,
  updateApp,
  updateSettings,
  saveWorkspace,
  workspaceFromActive,
  vaultChange,
  vaultCreate,
  vaultDisable,
  vaultLock,
  vaultReset,
  vaultUnlock,
  wipeData,
} from './admin';
import { probe, restorePrevious, saveLive, switchTo } from './engine';
import { answerAsk, cycleGuarded, findUnsaved, runGuarded } from './guarded';
import { clearSyncData, syncNow } from './sync';
import { openWorkspace, switchWorkspace } from './workspaces';
import { update } from './state';

async function handle(request: AnyRequest): Promise<unknown> {
  switch (request.type) {
    case 'probe':
      return probe(request.tabId);
    case 'switch': {
      const outcome = await switchTo({ ...request, kind: 'switch' });
      await scheduleAutoLock();
      return outcome;
    }
    case 'fresh':
      return switchTo({
        appId: request.appId,
        accountId: null,
        kind: 'fresh',
        tabId: request.tabId,
        focus: request.focus,
      });
    case 'cycle':
      return cycleGuarded(request.tabId, request.step);
    case 'unsaved':
      return findUnsaved(request.appIds);
    case 'ask.answer':
      return answerAsk(request.id, request.ok);
    case 'switch.guarded':
      return runGuarded(request.plan);
    case 'sync.now':
      await syncNow();
      return true;
    case 'sync.clear':
      await updateSettings({ syncList: false });
      await clearSyncData();
      return true;
    case 'save':
      return saveLive(request.appId, request.tabId, request.target);
    case 'restorePrevious':
      await restorePrevious(request.accountId);
      return true;
    case 'app.add':
      return addApp(request.app);
    case 'app.addMany':
      return addApps(request.apps);
    case 'app.update':
      return updateApp(request.id, request.patch);
    case 'app.remove':
      await removeApp(request.id);
      return true;
    case 'app.reorder':
      await reorderApps(request.ids);
      return true;
    case 'account.update':
      return updateAccount(request.id, request.patch);
    case 'account.remove':
      await removeAccount(request.id);
      return true;
    case 'account.reorder':
      await reorderAccounts(request.appId, request.ids);
      return true;
    case 'account.pin':
      return pinPage(request.id, request.url, request.title);
    case 'account.unpin':
      return unpinPage(request.id, request.pinId);
    case 'account.clearRecents':
      return clearRecents(request.id);
    case 'workspace.save':
      return saveWorkspace(request.id, request.workspace);
    case 'workspace.fromActive':
      return workspaceFromActive(request.name);
    case 'workspace.remove':
      await removeWorkspace(request.id);
      return true;
    case 'workspace.reorder':
      await reorderWorkspaces(request.ids);
      return true;
    case 'workspace.switch': {
      const outcome = await switchWorkspace(request.id, request.tabId);
      await scheduleAutoLock();
      return outcome;
    }
    case 'workspace.open': {
      const outcome = await openWorkspace(request.id, request.tabId);
      await scheduleAutoLock();
      return outcome;
    }
    case 'settings.update': {
      const settings = await updateSettings(request.patch);
      if ('autoLockMinutes' in request.patch) await scheduleAutoLock();
      return settings;
    }
    case 'vault.create':
      await vaultCreate(request.passphrase);
      return true;
    case 'vault.unlock':
      await vaultUnlock(request.passphrase);
      return true;
    case 'vault.lock':
      await vaultLock();
      return true;
    case 'vault.change':
      await vaultChange(request.current, request.next);
      return true;
    case 'vault.disable':
      await vaultDisable(request.passphrase);
      return true;
    case 'vault.reset':
      await vaultReset();
      return true;
    case 'backup.export':
      return exportBackup(request.password, request.includeSessions);
    case 'backup.inspect':
      return inspectBackup(request.text, request.password);
    case 'backup.import':
      return importBackup(request.text, request.password, request.mode);
    case 'history.clear':
      await update((draft) => {
        draft.history = [];
      });
      return true;
    case 'data.wipe':
      await wipeData();
      return true;
  }
}

function toError(error: unknown): { ok: false; error: ErrorCode; detail?: string } {
  if (error instanceof SwapdeckError)
    return { ok: false, error: error.code, ...(error.detail ? { detail: error.detail } : {}) };
  console.error('Swapdeck:', error);
  return { ok: false, error: 'UNKNOWN', detail: error instanceof Error ? error.message : String(error) };
}

export function isRequest(message: unknown): message is AnyRequest {
  return Boolean(message) && typeof (message as { type?: unknown }).type === 'string';
}

/** Answers requests from the extension's own pages. Content scripts and other extensions are refused. */
export function listen(): void {
  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || sender.tab?.url?.startsWith('http') || !isRequest(message)) return false;
    handle(message).then(
      (data) => sendResponse({ ok: true, data } satisfies Result<unknown>),
      (error: unknown) => sendResponse(toError(error)),
    );
    return true;
  });
}

export { handle };
