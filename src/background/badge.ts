import { appForUrl } from '../core/domains';
import { initials, readableTextColor, WARNING_COLOR } from '../core/util';
import { readSessionInfo, readState, type State } from '../shared/store';
import { translatorFor } from './engine';
import { tabUrl } from './tabs';

const NEUTRAL = '#6f665b';

/** Shows the active account of the tab's app on the toolbar icon (initials in its color). */
export async function refreshBadge(tab: chrome.tabs.Tab, known?: State): Promise<void> {
  const tabId = tab.id;
  if (tabId === undefined || tabId < 0) return;
  const state = known ?? (await readState());
  const t = translatorFor(state.settings);
  const app = appForUrl(state.apps, tabUrl(tab));
  let text = '';
  let color = NEUTRAL;
  let title = t('action.title');

  if (app) {
    const activeId = state.active[app.id];
    const account = activeId ? state.accounts.find((item) => item.id === activeId) : undefined;
    const hasAccounts = state.accounts.some((item) => item.appId === app.id);
    const { live } = await readSessionInfo();
    if (account) {
      text = initials(account.label);
      color = account.color;
      title = t('badge.active', {
        app: app.name,
        account: account.email ? `${account.label} (${account.email})` : account.label,
      });
      if (live[app.id]?.mismatch) {
        text = '!';
        color = WARNING_COLOR;
        title = t('badge.mismatch', { app: app.name });
      }
    } else if (hasAccounts) {
      text = '?';
      title = t('badge.none', { app: app.name });
    }
  }

  try {
    await chrome.action.setBadgeText({ tabId, text: state.settings.badge ? text : '' });
    await chrome.action.setBadgeBackgroundColor({ tabId, color });
    await chrome.action.setBadgeTextColor?.({ tabId, color: readableTextColor(color) });
    await chrome.action.setTitle({ tabId, title });
  } catch {
    // The tab closed meanwhile.
  }
}

export async function refreshAllBadges(): Promise<void> {
  const state = await readState();
  const tabs = await chrome.tabs.query({ active: true });
  await Promise.all(tabs.map((tab) => refreshBadge(tab, state)));
}
