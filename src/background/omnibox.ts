import { appForUrl } from '../core/domains';
import { rankAccounts, rankWorkspaces } from '../core/search';
import { liveMembers } from '../core/workspaces';
import { readState } from '../shared/store';
import { translatorFor } from './engine';
import { runGuarded } from './guarded';
import { activeTab, tabUrl } from './tabs';

/*
 * Address-bar switching: type "swd", a space, then part of a workspace, app or
 * account name ("swd acme", "swd supa work") and pick a suggestion.
 */

const PREFIX = 'swapdeck:';
const WORKSPACE_PREFIX = 'swapdeck-ws:';

function escapeXml(text: string): string {
  return text.replace(
    /[<>&'"]/g,
    (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[char]!,
  );
}

export { rankAccounts };

export function setupOmnibox(): void {
  chrome.omnibox.onInputStarted.addListener(async () => {
    const state = await readState();
    const t = translatorFor(state.settings);
    chrome.omnibox.setDefaultSuggestion({ description: escapeXml(t('omnibox.hint')) });
  });

  chrome.omnibox.onInputChanged.addListener(async (text, suggest) => {
    const state = await readState();
    const t = translatorFor(state.settings);
    const workspaces = rankWorkspaces(state.workspaces, text).slice(0, 3);
    const matches = rankAccounts(state.apps, state.accounts, text).slice(0, 8 - workspaces.length);
    suggest([
      ...workspaces.map((workspace) => ({
        content: `${WORKSPACE_PREFIX}${workspace.id}`,
        description:
          `<match>${escapeXml(t('omnibox.workspace'))}</match> · ${escapeXml(workspace.name)} ` +
          `<dim>${escapeXml(t('workspaces.appCount', { n: liveMembers(workspace, state.apps, state.accounts).length }))}</dim>`,
      })),
      ...matches.map(({ app, account }) => ({
        content: `${PREFIX}${account.id}`,
        description:
          `<match>${escapeXml(app.name)}</match> · ${escapeXml(account.label)}` +
          (account.email ? ` <dim>${escapeXml(account.email)}</dim>` : '') +
          (state.active[app.id] === account.id ? ` <dim>(${escapeXml(t('common.active'))})</dim>` : ''),
      })),
    ]);
  });

  chrome.omnibox.onInputEntered.addListener(async (text) => {
    const state = await readState();
    const workspaceId = text.startsWith(WORKSPACE_PREFIX)
      ? text.slice(WORKSPACE_PREFIX.length)
      : !text.startsWith(PREFIX)
        ? rankWorkspaces(state.workspaces, text)[0]?.id
        : undefined;
    if (workspaceId) {
      const current = await activeTab();
      await runGuarded({ kind: 'workspace', workspaceId, tabId: current?.id }).catch((error: unknown) =>
        console.warn('Swapdeck: omnibox workspace switch failed', error),
      );
      return;
    }
    const id = text.startsWith(PREFIX)
      ? text.slice(PREFIX.length)
      : rankAccounts(state.apps, state.accounts, text)[0]?.account.id;
    const account = state.accounts.find((item) => item.id === id);
    if (!account) return;
    // Switch in the current tab when it already shows this app; otherwise a tab is opened.
    const tab = await activeTab();
    const app = appForUrl(state.apps, tabUrl(tab));
    await runGuarded({
      kind: 'account',
      appId: account.appId,
      accountId: account.id,
      focus: true,
      ...(app?.id === account.appId && tab?.id !== undefined ? { tabId: tab.id } : {}),
    }).catch((error: unknown) => console.warn('Swapdeck: omnibox switch failed', error));
  });
}
