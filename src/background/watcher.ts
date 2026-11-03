import { appForUrl, originOf, parseHttpUrl } from '../core/domains';
import { hasIdentity, identityLabel, isSpecificDetector, sameIdentity, signedOutIsReliable } from '../core/identity';
import { recentFor, upsertRecent } from '../core/recents';
import type { Account, AppDef, Identity } from '../core/types';
import { initials, readableTextColor, WARNING_COLOR } from '../core/util';
import { readSessionInfo, readState, SESSION_KEYS, type LiveInfo, type State } from '../shared/store';
import { refreshBadge } from './badge';
import { ownerOfPage, routeLink } from './links';
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
/**
 * A page found signed out while an account with a saved session is in use, by
 * app and account: seen twice, a moment apart, the account is marked expired.
 */
const signedOutSince = new Map<string, number>();
const SIGNED_OUT_CONFIRM_MS = 2000;

async function setExpired(accountId: string, expired: boolean): Promise<void> {
  await update((draft) => {
    const account = draft.accounts.find((item) => item.id === accountId);
    if (!account) return;
    if (expired) account.expiredAt = Date.now();
    else delete account.expiredAt;
  });
}
/** Pages that are part of signing in or out are never remembered as "last page". */
const AUTH_PATH =
  /(^|\/)(log-?in|log-?out|sign-?in|sign-?out|sign-?up|auth|oauth|sso|callback|verify|2fa|mfa)(\/|$|\?)/i;

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

/**
 * Remembers the page and recent item for the active account (unless someone
 * else is signed in). A page that belongs to another saved account isn't
 * remembered for this one: Swapdeck offers to switch instead (links.ts).
 */
async function trackPage(app: AppDef, tab: chrome.tabs.Tab): Promise<void> {
  const url = tabUrl(tab);
  if (!url || !isTrackableUrl(app, url)) return;
  const { live } = await readSessionInfo();
  if (live[app.id]?.mismatch) return;
  if (await ownerOfPage(app, url)) {
    if (tab.id !== undefined) {
      void routeLink(app, tab.id, url).catch((error: unknown) => console.warn('Swapdeck: link check failed', error));
    }
    return;
  }
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
  if ((!strong && isSpecificDetector(app.detector)) || (!identity && signedOutIsReliable(app.detector, target))) {
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
      let expired: Account | null = null;
      const watchKey = `${app.id}|${activeId ?? ''}`;

      if (strong) {
        signedOutSince.delete(watchKey);
        const owner: Account | undefined =
          accounts.find((account) => sameIdentity(account, strong)) ??
          (active && !hasIdentity(active) ? active : undefined);
        if (active && owner?.id === active.id) {
          if (active.expiredAt) await setExpired(active.id, false);
          // Signed in again after the session expired: save the new one now (the saved copy is dead).
          const due = Boolean(active.expiredAt) || Date.now() - (lastSync.get(app.id) ?? 0) > SYNC_INTERVAL_MS;
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
      } else if (!identity && active?.capturedAt && signedOutIsReliable(app.detector, active) && onOrigin) {
        // Nobody is signed in while this account is in use: its saved session no longer works.
        const since = signedOutSince.get(watchKey);
        if (since === undefined) {
          signedOutSince.set(watchKey, Date.now());
          checkLater(app.id, tabId, SIGNED_OUT_CONFIRM_MS + 500);
        } else if (Date.now() - since >= SIGNED_OUT_CONFIRM_MS && !active.expiredAt) {
          await setExpired(active.id, true);
          expired = active;
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
      } else if (expired) {
        const account = expired as Account;
        await toast(tabId, latest, {
          title: t('toast.expiredTitle', { label: account.label }),
          body: t('toast.expiredBody'),
          badge: '!',
          color: WARNING_COLOR,
          tone: 'warning',
        });
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
