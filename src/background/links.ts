import { appForUrl } from '../core/domains';
import { linkOwner, type LinkOwner } from '../core/links';
import { recentFor, upsertRecent } from '../core/recents';
import type { AppDef } from '../core/types';
import { initials, readableTextColor } from '../core/util';
import { readState } from '../shared/store';
import { updateSettings } from './admin';
import { busyApps, translatorFor } from './engine';
import { runGuarded } from './guarded';
import { askLinkOnPage, type LinkAnswer } from './page-scripts';
import { update } from './state';
import { getTab, runInTab } from './tabs';

/**
 * "Open links with the right account": when a page of an added app belongs to
 * another saved account (its rules, recent items or pinned pages say so — see
 * core/links.ts), offer to switch to it on the page, or switch at once
 * (Settings → links of another account). The switch goes through runGuarded
 * (important accounts, unsaved work) and reopens that same page.
 */

const PROMPT_TIMEOUT_MS = 30_000;
/** A tab just switched for a link isn't asked about again for a while. */
const ROUTED_QUIET_MS = 20_000;
/** Links the user said "not now" to (this Chrome session). */
const DECLINED_KEY = 'sd:linksDeclined';
const DECLINED_LIMIT = 200;

const prompting = new Set<number>();
const routedAt = new Map<number, number>();
/** Questions left unanswered, per tab: not asked again in that tab. */
const ignored = new Map<number, Set<string>>();

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([promise, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);
}

async function declined(): Promise<string[]> {
  const raw: unknown = (await chrome.storage.session.get(DECLINED_KEY))[DECLINED_KEY];
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : [];
}

async function decline(key: string): Promise<void> {
  const list = (await declined()).filter((item) => item !== key);
  await chrome.storage.session.set({ [DECLINED_KEY]: [key, ...list].slice(0, DECLINED_LIMIT) });
}

/** The page's owner, if it is another account with a sign-in saved here. */
export async function ownerOfPage(app: AppDef, url: string): Promise<LinkOwner | null> {
  const state = await readState();
  const accounts = state.accounts.filter((account) => account.appId === app.id);
  const owner = linkOwner(app, accounts, url, state.active[app.id]);
  if (!owner) return null;
  const account = accounts.find((item) => item.id === owner.accountId);
  return account?.capturedAt ? owner : null;
}

/** Called by the watcher for a page it just tracked (trackable, not during a switch). */
export async function routeLink(app: AppDef, tabId: number, url: string): Promise<void> {
  if (prompting.has(tabId) || busyApps.has(app.id)) return;
  if (Date.now() - (routedAt.get(tabId) ?? 0) < ROUTED_QUIET_MS) return;
  const state = await readState();
  if (state.settings.linkRouting === 'off') return;
  const owner = await ownerOfPage(app, url);
  if (!owner) return;
  const declineKey = `${app.id}|${owner.accountId}|${owner.match}`;
  if (ignored.get(tabId)?.has(declineKey) || (await declined()).includes(declineKey)) return;
  const account = state.accounts.find((item) => item.id === owner.accountId)!;
  const active = state.accounts.find((item) => item.id === state.active[app.id]);

  const go = async () => {
    routedAt.set(tabId, Date.now());
    await runGuarded({ kind: 'account', appId: app.id, accountId: account.id, tabId, url });
  };
  if (state.settings.linkRouting === 'auto') {
    await go();
    return;
  }

  const t = translatorFor(state.settings);
  prompting.add(tabId);
  const answer: LinkAnswer = await withTimeout(
    runInTab(tabId, askLinkOnPage, [
      {
        title: t('links.promptTitle', { label: account.label }),
        body: active
          ? t('links.promptBody', { active: active.label, app: app.name, label: account.label })
          : t('links.promptBodyNone', { app: app.name, label: account.label }),
        badge: account.emoji ?? initials(account.label),
        color: account.color,
        badgeText: readableTextColor(account.color),
        switchLabel: t('links.switch', { label: account.label }),
        alwaysLabel: t('links.always'),
        noLabel: t('links.notNow'),
        closeLabel: t('common.close'),
        theme: state.settings.theme,
        timeoutMs: PROMPT_TIMEOUT_MS,
      },
    ]).catch(() => null),
    PROMPT_TIMEOUT_MS + 2000,
  ).finally(() => prompting.delete(tabId));
  if (answer === 'switch' || answer === 'always') {
    if (answer === 'always') await updateSettings({ linkRouting: 'auto' });
    // The tab may have moved on while the question was open: reopen the page it was asked about.
    if ((await getTab(tabId)) === null) return;
    await go();
  } else if (answer === null) {
    if (ignored.size > 500) ignored.clear();
    ignored.set(tabId, new Set([...(ignored.get(tabId) ?? []), declineKey]));
  } else if (answer === 'no') {
    await decline(declineKey);
    // A recent item the account in use opens too: it is shared, stop asking about it.
    if (owner.why === 'recent' && active) {
      const tab = await getTab(tabId);
      const recent = recentFor(app, url, tab?.title);
      if (recent) {
        await update((draft) => {
          const account = draft.accounts.find((item) => item.id === active.id);
          if (account) account.recents = upsertRecent(account.recents, recent);
        });
      }
    }
  }
}

/** Right-click on a link → "Open link as …": switch that app to the account and open the link. */
export async function openLinkAs(appId: string, accountId: string, url: string, besideTabId?: number): Promise<void> {
  const state = await readState();
  const app = state.apps.find((item) => item.id === appId);
  const account = state.accounts.find((item) => item.id === accountId && item.appId === appId);
  if (!app || !account || appForUrl([app], url) !== app) return;
  const beside = besideTabId !== undefined ? await getTab(besideTabId) : null;
  // A new tab for the link (the switch then reuses it), next to the page it was found on.
  const tab = await chrome.tabs.create({
    url,
    active: true,
    ...(beside ? { index: beside.index + 1, windowId: beside.windowId } : {}),
  });
  if (tab.id === undefined) return;
  routedAt.set(tab.id, Date.now());
  // The switch finds the app's tabs by their address: wait until the new tab has one.
  for (let tries = 0; tries < 30 && !(await getTab(tab.id))?.url?.startsWith('http'); tries++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (state.active[app.id] === account.id) return;
  await runGuarded({ kind: 'account', appId, accountId, tabId: tab.id, url, focus: true });
}
