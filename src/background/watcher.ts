import { appForUrl, originOf, parseHttpUrl } from '../core/domains';
import { hasIdentity, identityLabel, isSpecificDetector, sameIdentity } from '../core/identity';
import type { Account, AppDef, Identity, RecentItem } from '../core/types';
import { initials, readableTextColor, WARNING_COLOR } from '../core/util';
import { readSessionInfo, readState, SESSION_KEYS, type LiveInfo, type State } from '../shared/store';
import { refreshBadge } from './badge';
import {
  busyApps,
  capture,
  detectLive,
  hasAccess,
  pendingToasts,
  persist,
  stagingCandidates,
  stagingUrl,
  translatorFor,
  withAppLock,
  type ToastIntent,
} from './engine';
import { showRibbon, showToast, type ToastContent } from './page-scripts';
import { pushHistory, update } from './state';
import { getTab, runInTab, tabUrl } from './tabs';

/** Auto-sync refreshes a saved session at most this often per app. */
const SYNC_INTERVAL_MS = 60_000;
const lastSync = new Map<string, number>();
/** Pages that are part of signing in or out are never remembered as "last page". */
const AUTH_PATH =
  /(^|\/)(log-?in|log-?out|sign-?in|sign-?out|sign-?up|auth|oauth|sso|callback|verify|2fa|mfa)(\/|$|\?)/i;
const RECENT_LIMIT = 6;

/** The switching page itself, or one of its fallbacks while a switch runs. */
function isStagingUrl(app: AppDef, url: string | null): boolean {
  if (!url) return false;
  if (url === stagingUrl(app)) return true;
  return busyApps.has(app.id) && stagingCandidates(app).includes(url);
}

export async function setLive(appId: string, info: LiveInfo | null): Promise<void> {
  const { live } = await readSessionInfo();
  if (info) live[appId] = info;
  else delete live[appId];
  await chrome.storage.session.set({ [SESSION_KEYS.live]: live });
}

export function isTrackableUrl(app: AppDef, url: string): boolean {
  const parsed = parseHttpUrl(url);
  if (!parsed) return false;
  if (isStagingUrl(app, url)) return false;
  return !AUTH_PATH.test(parsed.pathname);
}

/** A recent item (e.g. a Supabase project) for a page URL, using the app's pattern. */
export function recentFor(app: AppDef, url: string, title: string | undefined): RecentItem | null {
  if (!app.recentPattern) return null;
  const parsed = parseHttpUrl(url);
  if (!parsed) return null;
  let match: RegExpExecArray | null;
  try {
    match = new RegExp(app.recentPattern).exec(parsed.pathname);
  } catch {
    return null;
  }
  if (!match?.[1]) return null;
  let clean = (title ?? '').trim();
  if (app.titleSuffix && clean.endsWith(app.titleSuffix)) clean = clean.slice(0, -app.titleSuffix.length).trim();
  // Titles like "Table editor | my-project" put the item name last.
  const parts = clean.split(/\s+[|·–—-]\s+/).filter(Boolean);
  const name = parts.length > 1 ? parts[parts.length - 1]! : clean;
  const generic = !name || name.toLowerCase() === app.name.toLowerCase();
  return { key: match[1], title: generic ? match[1] : name, url: parsed.origin + match[0], at: Date.now() };
}

export function upsertRecent(recents: readonly RecentItem[], item: RecentItem): RecentItem[] {
  const existing = recents.find((recent) => recent.key === item.key);
  // Keep a real name rather than replacing it with the bare key from an early title.
  const title = item.title === item.key && existing && existing.title !== existing.key ? existing.title : item.title;
  return [{ ...item, title }, ...recents.filter((recent) => recent.key !== item.key)].slice(0, RECENT_LIMIT);
}

/** Remembers the page and recent item for the active account (unless someone else is signed in). */
async function trackPage(app: AppDef, tab: chrome.tabs.Tab): Promise<void> {
  const url = tabUrl(tab);
  if (!url || !isTrackableUrl(app, url)) return;
  const { live } = await readSessionInfo();
  if (live[app.id]?.mismatch) return;
  const recent = recentFor(app, url, tab.title);
  await update((draft) => {
    const activeId = draft.active[app.id];
    const account = activeId ? draft.accounts.find((item) => item.id === activeId) : undefined;
    if (!account) return;
    account.lastUrl = url;
    if (recent) account.recents = upsertRecent(account.recents, recent);
  });
}

function toastFor(
  state: State,
  app: AppDef,
  intent: ToastIntent,
  identity: Identity | null,
): Omit<ToastContent, 'theme' | 'closeLabel' | 'durationMs' | 'badgeText'> | null {
  const t = translatorFor(state.settings);
  const target = intent.accountId ? state.accounts.find((account) => account.id === intent.accountId) : undefined;
  const savedAsNew = intent.savedAsNew ? state.accounts.find((account) => account.id === intent.savedAsNew) : undefined;
  const extra = savedAsNew ? ` ${t('toast.previousSavedAsNew', { label: savedAsNew.label })}` : '';

  if (intent.kind === 'fresh') {
    const auto = state.settings.autoCapture && app.detector.kind !== 'none';
    return {
      title: t('toast.freshTitle', { app: app.name }),
      body: (auto ? t('toast.freshBodyAuto') : t('toast.freshBodyManual')) + extra,
      badge: '+',
      color: app.color,
      tone: 'info',
    };
  }
  if (!target) return null;
  const strong = identity?.confidence === 'strong' ? identity : null;
  if (strong && hasIdentity(target) && !sameIdentity(target, strong)) {
    return {
      title: t('toast.wrongTitle', { who: identityLabel(strong) }),
      body: t('toast.wrongBody', { label: target.label }),
      badge: '!',
      color: WARNING_COLOR,
      tone: 'warning',
    };
  }
  if (!strong && isSpecificDetector(app.detector)) {
    return {
      title: t('toast.expiredTitle', { label: target.label }),
      body: t('toast.expiredBody'),
      badge: '!',
      color: WARNING_COLOR,
      tone: 'warning',
    };
  }
  return {
    title: target.important
      ? t('toast.importantTitle', { label: target.label })
      : t('toast.switchedTitle', { label: target.label }),
    body: (target.email ?? strong?.email ?? app.name) + extra,
    badge: target.emoji ?? initials(target.label),
    color: target.color,
    tone: target.important ? 'warning' : 'success',
  };
}

/**
 * Keeps the warning strip on an app's pages while the account signed in there
 * is marked important (apps without important accounts are left alone).
 */
async function markImportant(app: AppDef, tabId: number, identity: Identity | null): Promise<void> {
  const state = await readState();
  const accounts = state.accounts.filter((account) => account.appId === app.id);
  if (!accounts.some((account) => account.important)) return;
  const strong = identity?.confidence === 'strong' ? identity : null;
  const active = accounts.find((account) => account.id === state.active[app.id]);
  // Who is really signed in: the recognised account, else the one in use (unless the page shows nobody).
  const owner = strong
    ? accounts.find((account) => sameIdentity(account, strong))
    : identity || app.detector.kind === 'none'
      ? active
      : undefined;
  const t = translatorFor(state.settings);
  await runInTab(tabId, showRibbon, [
    owner?.important ? { tag: t('account.importantTag'), label: owner.label } : null,
  ]).catch(() => undefined);
}

async function toast(
  tabId: number,
  state: State,
  content: Omit<ToastContent, 'theme' | 'closeLabel' | 'durationMs' | 'badgeText'>,
) {
  if (!state.settings.pageToasts) return;
  const t = translatorFor(state.settings);
  await runInTab(tabId, showToast, [
    {
      ...content,
      badgeText: readableTextColor(content.color),
      theme: state.settings.theme,
      closeLabel: t('common.close'),
      durationMs: 5200,
    },
  ]).catch(() => undefined);
}

/**
 * After an app page loads: find out who is signed in, keep the saved session of
 * the active account fresh, adopt sessions signed in by hand (never losing one),
 * and confirm a switch that just finished. Returns who is signed in.
 */
async function reconcile(app: AppDef, tab: chrome.tabs.Tab): Promise<Identity | null> {
  const tabId = tab.id!;
  const intent = pendingToasts.get(tabId);
  pendingToasts.delete(tabId);
  const url = tabUrl(tab);
  const onOrigin = originOf(url ?? '') === app.origin;

  const identity = await withAppLock(
    app.id,
    async () => {
      const state = await readState();
      const t = translatorFor(state.settings);
      const identity = await detectLive(app, tab);
      const strong = identity?.confidence === 'strong' ? identity : null;
      const accounts = state.accounts.filter((account) => account.appId === app.id);
      const activeId = state.active[app.id] ?? null;
      const active = accounts.find((account) => account.id === activeId);
      const info: LiveInfo = { identity, mismatch: false, checkedAt: Date.now(), ...(url ? { url } : {}) };
      let adopted: { account: Account | undefined; created: boolean } | null = null;

      if (strong) {
        const owner: Account | undefined =
          accounts.find((account) => sameIdentity(account, strong)) ??
          (active && !hasIdentity(active) ? active : undefined);
        if (active && owner?.id === active.id) {
          const due = Date.now() - (lastSync.get(app.id) ?? 0) > SYNC_INTERVAL_MS;
          if (state.settings.autoSync && onOrigin && due) {
            lastSync.set(app.id, Date.now());
            await persist(app, await capture(app, tabId), { kind: 'active', accountId: active.id }, t, true).catch(
              (error: unknown) => console.warn('Swapdeck: auto-sync failed', error),
            );
          }
        } else if (state.settings.autoCapture && onOrigin) {
          // Signed in as someone else than the active account: keep that session.
          const captured = await capture(app, tabId);
          const saved = await persist(
            app,
            captured,
            owner ? { kind: 'existing', accountId: owner.id } : { kind: 'new' },
            t,
          );
          lastSync.set(app.id, Date.now());
          await update((draft) => {
            draft.active[app.id] = saved.accountId;
            const account = draft.accounts.find((item) => item.id === saved.accountId);
            pushHistory(draft, {
              kind: 'auto-save',
              appId: app.id,
              appName: app.name,
              fromId: activeId,
              fromLabel: active?.label,
              toId: saved.accountId,
              toLabel: account?.label,
              ok: true,
            });
            adopted = { account: account ? { ...account } : undefined, created: saved.created };
          });
        } else {
          info.mismatch = true;
        }
      }
      await setLive(app.id, info);

      const latest = await readState();
      const done = adopted as { account: Account | undefined; created: boolean } | null;
      if (done?.account && !intent) {
        await toast(tabId, latest, {
          title: done.created
            ? t('toast.savedNewTitle', { label: done.account.label })
            : t('toast.recognizedTitle', { label: done.account.label }),
          body: done.created ? t('toast.savedNewBody') : (done.account.email ?? app.name),
          badge: done.account.emoji ?? initials(done.account.label),
          color: done.account.color,
          tone: 'success',
        });
      } else if (intent && Date.now() - intent.at < 60_000) {
        const content = toastFor(latest, app, intent, identity);
        if (content) await toast(tabId, latest, content);
      }
      return identity;
    },
    false,
  );
  await trackPage(app, tab);
  return identity;
}

const followUps = new Map<number, ReturnType<typeof setTimeout>>();

/**
 * Checks a tab again a little later. Single-page apps (the Supabase dashboard
 * among them) sign in without reloading: the address changes, and the session
 * is written just before or after the page finished loading.
 */
function checkLater(appId: string, tabId: number, delayMs: number): void {
  clearTimeout(followUps.get(tabId));
  followUps.set(
    tabId,
    setTimeout(() => {
      followUps.delete(tabId);
      void (async () => {
        const tab = await getTab(tabId);
        if (!tab || tab.status !== 'complete' || busyApps.has(appId)) return;
        const state = await readState();
        const app = appForUrl(state.apps, tabUrl(tab));
        if (app?.id !== appId || isStagingUrl(app, tabUrl(tab))) return;
        const identity = await reconcile(app, tab);
        await markImportant(app, tabId, identity);
        void refreshBadge(tab);
      })().catch((error: unknown) => console.warn('Swapdeck: page check failed', error));
    }, delayMs),
  );
}

export async function onTabUpdated(tabId: number, info: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) {
  if (info.status !== 'complete' && !info.url && info.title === undefined) return;
  const state = await readState();
  if (info.status === 'complete' || info.url) void refreshBadge(tab, state);
  const app = appForUrl(state.apps, tabUrl(tab));
  if (!app || tab.incognito || isStagingUrl(app, tabUrl(tab))) return;
  // URL and title changes during a switch belong to the switch itself.
  if (info.status !== 'complete' && busyApps.has(app.id)) return;
  if (!(await hasAccess(app))) return;
  try {
    if (info.status === 'complete') {
      clearTimeout(followUps.get(tabId));
      const identity = await reconcile(app, { ...tab, id: tabId });
      await markImportant(app, tabId, identity);
      if (!identity && app.detector.kind !== 'none') checkLater(app.id, tabId, 2500);
    } else {
      await trackPage(app, tab);
      if (info.url && tab.status === 'complete') checkLater(app.id, tabId, 900);
    }
  } catch (error) {
    console.warn('Swapdeck: page check failed', error);
  } finally {
    void refreshBadge(tab);
  }
}
