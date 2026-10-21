import { ExternalLink } from 'lucide-react';
import { rankAccounts, rankApps, rankWorkspaces } from '../core/search';
import { workspaceStatus } from '../core/workspaces';
import { AppIcon } from '../ui/Avatar';
import { useI18n } from '../ui/i18n';
import { useSwitcher } from './context';
import { AccountRow } from './parts';
import { WorkspaceBadge } from './WorkspaceBar';

const LIMIT = 8;

/** Results across workspaces, accounts and apps for the popup's search box. */
export function SearchResults({ query, onSelectApp }: { query: string; onSelectApp: (appId: string) => void }) {
  const { t } = useI18n();
  const { data, busy, switchAccount, switchWorkspace } = useSwitcher();
  const { state } = data;
  const workspaces = rankWorkspaces(state.workspaces, query).slice(0, 4);
  const accounts = rankAccounts(state.apps, state.accounts, query).slice(0, LIMIT);
  const apps = rankApps(state.apps, query).slice(0, 6);

  if (!workspaces.length && !accounts.length && !apps.length) {
    return <p className="muted search-empty">{t('popup.noMatches', { query })}</p>;
  }

  return (
    <div className="search-results">
      {workspaces.length > 0 && (
        <section className="section" aria-labelledby="results-workspaces">
          <h2 className="section__title" id="results-workspaces">
            {t('workspaces.short')}
          </h2>
          <div className="result-list" role="list">
            {workspaces.map((workspace) => {
              const status = workspaceStatus(workspace, state.apps, state.accounts, state.active);
              return (
                <div key={workspace.id} role="listitem">
                  <button
                    type="button"
                    className="result-row"
                    disabled={busy !== null || status.total === 0}
                    onClick={() => void switchWorkspace(workspace)}
                  >
                    <WorkspaceBadge workspace={workspace} size={28} />
                    <span className="result-row__text">
                      <span className="result-row__name">
                        <span className="visually-hidden">{t('workspaces.switchPrefix')} </span>
                        {workspace.name}
                      </span>
                      <span className="muted truncate">
                        {status.state === 'active'
                          ? t('workspaces.inUse')
                          : t('workspaces.appCount', { n: status.total })}
                      </span>
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}
      {accounts.length > 0 && (
        <section className="section" aria-labelledby="results-accounts">
          <h2 className="section__title" id="results-accounts">
            {t('popup.accountsResults')}
          </h2>
          <div className="accounts" role="list">
            {accounts.map(({ app, account }, index) => (
              <AccountRow
                key={account.id}
                account={account}
                index={index}
                appName={app.name}
                active={state.active[app.id] === account.id}
                busy={busy === `acc:${account.id}`}
                disabled={busy !== null}
                menu={[
                  {
                    label: t('account.switchAndOpen'),
                    icon: <ExternalLink />,
                    disabled: !account.capturedAt,
                    onSelect: () => void switchAccount(app, account, { open: true }),
                  },
                ]}
                onSwitch={() => void switchAccount(app, account)}
                onOpen={(url) => void switchAccount(app, account, { url, open: true })}
              />
            ))}
          </div>
        </section>
      )}
      {apps.length > 0 && (
        <section className="section" aria-labelledby="results-apps">
          <h2 className="section__title" id="results-apps">
            {t('popup.yourApps')}
          </h2>
          <div className="result-list" role="list">
            {apps.map((app) => (
              <div key={app.id} role="listitem">
                <button type="button" className="result-row" onClick={() => onSelectApp(app.id)}>
                  <AppIcon app={app} />
                  <span className="result-row__text">
                    <span className="result-row__name">{app.name}</span>
                    <span className="muted truncate">{app.domains.join(', ')}</span>
                  </span>
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
