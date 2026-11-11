import { matchPatterns } from '../core/domains';
import { workspaceStatus } from '../core/workspaces';
import { readState } from '../shared/store';
import { translatorFor } from './engine';

/*
 * Right-click menu on the pages of each added app: its accounts (the active one
 * checked), "sign in with another account", "save this session" and "manage".
 * Chrome shows each app's menu only on that app's pages (documentUrlPatterns).
 * On a link to an added app, "Open link as" lists its accounts with a saved
 * sign-in (targetUrlPatterns), and "Open link in a separate tab as" too.
 * Pages also offer a separate tab for another account and a scratch tab.
 * Right-clicking the toolbar button lists the workspaces and opens the side panel.
 */

let rebuildTimer: ReturnType<typeof setTimeout> | undefined;
let rebuilding: Promise<void> = Promise.resolve();

export type MenuAction =
  | { kind: 'switch'; appId: string; accountId: string }
  | { kind: 'linkAs'; appId: string; accountId: string }
  | { kind: 'lane'; appId: string; accountId: string }
  | { kind: 'laneLink'; appId: string; accountId: string }
  | { kind: 'scratch'; appId: string }
  | { kind: 'fresh'; appId: string }
  | { kind: 'save'; appId: string }
  | { kind: 'manage'; appId?: string }
  | { kind: 'workspace'; workspaceId: string }
  | { kind: 'panel' };

export function parseMenuId(id: string | number): MenuAction | null {
  const [kind, appId, accountId] = String(id).split('|');
  if (kind === 'switch' && appId && accountId) return { kind, appId, accountId };
  if (kind === 'linkas' && appId && accountId) return { kind: 'linkAs', appId, accountId };
  if (kind === 'lane' && appId && accountId) return { kind: 'lane', appId, accountId };
  if (kind === 'lanelink' && appId && accountId) return { kind: 'laneLink', appId, accountId };
  if (kind === 'scratch' && appId) return { kind: 'scratch', appId };
  if ((kind === 'fresh' || kind === 'save') && appId) return { kind, appId };
  if (kind === 'manage') return appId ? { kind: 'manage', appId } : { kind: 'manage' };
  if (kind === 'ws' && appId) return { kind: 'workspace', workspaceId: appId };
  if (kind === 'panel') return { kind: 'panel' };
  return null;
}

/** What the menus show; rebuilding is skipped when it hasn't changed (e.g. a page visit). */
let builtSignature: string | null = null;

async function build(): Promise<void> {
  const state = await readState();
  const signature = JSON.stringify([
    state.settings.language,
    state.active,
    state.apps.map((app) => [app.id, app.name, app.domains]),
    state.accounts.map((account) => [
      account.id,
      account.appId,
      account.label,
      account.email,
      account.order,
      Boolean(account.capturedAt),
    ]),
    state.workspaces.map((workspace) => [workspace.id, workspace.name, workspace.emoji, workspace.members]),
  ]);
  if (signature === builtSignature) return;
  builtSignature = signature;
  await chrome.contextMenus.removeAll();
  const t = translatorFor(state.settings);

  // On the toolbar button: workspaces (the one fully in use is checked) and the side panel.
  if (state.workspaces.length) {
    chrome.contextMenus.create({ id: 'ws-root', title: t('menu.workspaces'), contexts: ['action'] });
    for (const workspace of state.workspaces) {
      const status = workspaceStatus(workspace, state.apps, state.accounts, state.active);
      chrome.contextMenus.create({
        id: `ws|${workspace.id}`,
        parentId: 'ws-root',
        type: 'radio',
        checked: status.state === 'active',
        title: `${workspace.emoji ? `${workspace.emoji} ` : ''}${workspace.name}`,
        contexts: ['action'],
        enabled: status.total > 0,
      });
    }
  }
  chrome.contextMenus.create({ id: 'panel', title: t('menu.sidePanel'), contexts: ['action'] });

  for (const app of state.apps) {
    const accounts = state.accounts.filter((account) => account.appId === app.id);
    const documentUrlPatterns = matchPatterns(app);
    const parentId = `app|${app.id}`;
    chrome.contextMenus.create({
      id: parentId,
      title: t('menu.parent', { app: app.name }),
      contexts: ['page', 'frame'],
      documentUrlPatterns,
    });
    for (const account of accounts) {
      chrome.contextMenus.create({
        id: `switch|${app.id}|${account.id}`,
        parentId,
        type: 'radio',
        checked: state.active[app.id] === account.id,
        title: account.email && account.email !== account.label ? `${account.label} — ${account.email}` : account.label,
        contexts: ['page', 'frame'],
        documentUrlPatterns,
      });
    }
    if (accounts.length) {
      chrome.contextMenus.create({
        id: `sep|${app.id}`,
        parentId,
        type: 'separator',
        contexts: ['page', 'frame'],
        documentUrlPatterns,
      });
    }
    chrome.contextMenus.create({
      id: `fresh|${app.id}`,
      parentId,
      title: t('menu.fresh'),
      contexts: ['page', 'frame'],
      documentUrlPatterns,
    });
    // Separate tabs: another saved account next to this one, or a scratch sign-in.
    const others = accounts.filter((account) => account.capturedAt && account.id !== state.active[app.id]);
    if (others.length) {
      chrome.contextMenus.create({
        id: `lanes|${app.id}`,
        parentId,
        title: t('menu.laneAs'),
        contexts: ['page', 'frame'],
        documentUrlPatterns,
      });
      for (const account of others) {
        chrome.contextMenus.create({
          id: `lane|${app.id}|${account.id}`,
          parentId: `lanes|${app.id}`,
          title: account.label,
          contexts: ['page', 'frame'],
          documentUrlPatterns,
        });
      }
    }
    chrome.contextMenus.create({
      id: `scratch|${app.id}`,
      parentId,
      title: t('menu.scratch'),
      contexts: ['page', 'frame'],
      documentUrlPatterns,
    });
    chrome.contextMenus.create({
      id: `save|${app.id}`,
      parentId,
      title: t('menu.save'),
      contexts: ['page', 'frame'],
      documentUrlPatterns,
    });
    chrome.contextMenus.create({
      id: `manage|${app.id}`,
      parentId,
      title: t('menu.manage'),
      contexts: ['page', 'frame'],
      documentUrlPatterns,
    });

    const signedIn = accounts.filter((account) => account.capturedAt);
    if (signedIn.length) {
      const linkParent = `link|${app.id}`;
      const targetUrlPatterns = documentUrlPatterns;
      chrome.contextMenus.create({
        id: linkParent,
        title: t('menu.openLinkAs', { app: app.name }),
        contexts: ['link'],
        targetUrlPatterns,
      });
      for (const account of signedIn) {
        chrome.contextMenus.create({
          id: `linkas|${app.id}|${account.id}`,
          parentId: linkParent,
          title:
            account.email && account.email !== account.label ? `${account.label} — ${account.email}` : account.label,
          contexts: ['link'],
          targetUrlPatterns,
        });
      }
      const laneAccounts = signedIn.filter((account) => account.id !== state.active[app.id]);
      if (laneAccounts.length) {
        chrome.contextMenus.create({
          id: `lanelinks|${app.id}`,
          parentId: linkParent,
          type: 'separator',
          contexts: ['link'],
          targetUrlPatterns,
        });
        for (const account of laneAccounts) {
          chrome.contextMenus.create({
            id: `lanelink|${app.id}|${account.id}`,
            parentId: linkParent,
            title: `${t('menu.laneLinkAs')} ${account.label}`,
            contexts: ['link'],
            targetUrlPatterns,
          });
        }
      }
    }
  }
}

/**
 * Rebuilds the menus even though nothing changed: Chrome checks a radio item
 * as soon as it is clicked, so a switch that was cancelled (or failed) must
 * put the check back on the account or workspace really in use.
 */
export function refreshMenus(): void {
  builtSignature = null;
  scheduleMenuRebuild(0);
}

/** Rebuilds the menus shortly after the last change (changes often come in bursts). */
export function scheduleMenuRebuild(delayMs = 250): void {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    rebuilding = rebuilding.then(build).catch((error: unknown) => console.warn('Swapdeck: menu rebuild failed', error));
  }, delayMs);
}
