import {
  AppWindow,
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  Ellipsis,
  ExternalLink,
  LockOpen,
  LogIn,
  Pencil,
  Pin,
  RotateCcw,
  Search,
  Send,
  SquareDashed,
  Trash2,
  TriangleAlert,
  Upload,
  UserPlus,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { displayUrl } from '../../core/domains';
import { rankAccounts } from '../../core/search';
import type { Account, AppDef } from '../../core/types';
import { formatBytes, relativeTime } from '../../i18n/translate';
import { appToInput } from '../../shared/apps';
import { hasAccess, onAccessChange, requestAccess } from '../../ui/access';
import { AccountEditor } from '../../ui/AccountEditor';
import { useAskBeforeLaneClose, useAskBeforeSwitch } from '../../ui/askBeforeSwitch';
import { AppIcon, Avatar } from '../../ui/Avatar';
import { Callout, MenuButton, Spinner, useConfirm, useToast, type MenuItem } from '../../ui/controls';
import { ExpiredFlag, LaneFlag } from '../../ui/flags';
import { usePreviousSessions } from '../../ui/hooks';
import { useI18n } from '../../ui/i18n';
import { WorkspaceTags } from '../../ui/WorkspaceTags';
import { useManager } from '../context';
import { Card } from '../Options';
import { navigate } from '../router';
import { moveId } from './Apps';
import { AppForm } from './AppForm';
import { SeparateTabsCard } from './SeparateTabs';
import { ImportSessionDialog, ShareDialog } from './SessionDialogs';

/** With more accounts than this, an app's page offers a filter box. */
const FILTER_FROM = 8;

export function useAccess(app: AppDef | undefined): [boolean | null, () => Promise<void>] {
  const [granted, setGranted] = useState<boolean | null>(null);
  useEffect(() => {
    if (!app) return;
    const check = () => void hasAccess(app).then(setGranted);
    check();
    return onAccessChange(check);
  }, [app]);
  return [granted, async () => setGranted(app ? await requestAccess(app) : false)];
}

export function AppDetail({ id, tab }: { id: string; tab: 'accounts' | 'settings' }) {
  const { t } = useI18n();
  const askBeforeSwitch = useAskBeforeSwitch();
  const { data, run, pending } = useManager();
  const notify = useToast();
  const confirm = useConfirm();
  const app = data.state.apps.find((item) => item.id === id);
  const [granted, allow] = useAccess(app);
  const [importing, setImporting] = useState(false);

  if (!app) {
    return (
      <div className="empty-card">
        <p>{t('error.NOT_FOUND')}</p>
        <a className="btn" href="#/apps">
          {t('common.back')}
        </a>
      </div>
    );
  }
  const accounts = data.state.accounts.filter((account) => account.appId === app.id);
  const active = accounts.find((account) => account.id === data.state.active[app.id]);

  const removeApp = async () => {
    if (
      await confirm({
        title: t('apps.remove'),
        body: t('apps.removeConfirm', { app: app.name, n: accounts.length }),
        confirmLabel: t('common.remove'),
        danger: true,
      })
    ) {
      if (await run('app.remove', { id: app.id })) navigate('#/apps');
    }
  };

  return (
    <div className="stack">
      <nav className="breadcrumb" aria-label={t('nav.breadcrumb')}>
        <a href="#/apps">{t('nav.apps')}</a>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{app.name}</span>
      </nav>
      <header className="app-header">
        <AppIcon app={app} size="lg" />
        <div className="app-header__text">
          <h1>{app.name}</h1>
          <p className="muted">{app.domains.join(', ')}</p>
        </div>
        <div className="app-header__actions">
          <button
            type="button"
            className="btn"
            onClick={() => void chrome.tabs.create({ url: active?.lastUrl ?? app.homeUrl })}
          >
            <ExternalLink /> {t('common.open')}
          </button>
          <button
            type="button"
            className="btn btn--dashed"
            disabled={!granted || pending === 'fresh'}
            onClick={async () => {
              const go = await askBeforeSwitch({
                kind: 'fresh',
                label: app.name,
                app: app.name,
                important: [],
                confirmAll: data.state.settings.confirmSwitch,
                appIds: [app.id],
              });
              if (!go) return;
              const outcome = await run('fresh', { appId: app.id, focus: true }, 'fresh');
              if (outcome) notify(t('toast.freshTitle', { app: app.name }), 'info');
            }}
          >
            {pending === 'fresh' ? <Spinner /> : <UserPlus />} {t('popup.newLogin')}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            title={t('lane.scratchHint')}
            disabled={!granted || pending === 'lane.scratch'}
            onClick={() => void run('lane.open', { appId: app.id, accountId: null }, 'lane.scratch')}
          >
            {pending === 'lane.scratch' ? <Spinner /> : <SquareDashed />} {t('lane.scratch')}
          </button>
          <MenuButton
            label={t('common.more')}
            icon={<Ellipsis />}
            className="btn btn--icon"
            items={[
              { label: t('importSession.menu'), icon: <Upload />, onSelect: () => setImporting(true) },
              { kind: 'separator' },
              { label: t('apps.remove'), icon: <Trash2 />, danger: true, onSelect: () => void removeApp() },
            ]}
          />
        </div>
      </header>
      <ImportSessionDialog open={importing} onClose={() => setImporting(false)} app={app} />

      {granted === false && (
        <Callout
          tone="warning"
          title={t('apps.accessMissing', { domains: app.domains.join(', ') })}
          actions={
            <button type="button" className="btn btn--primary btn--sm" onClick={() => void allow()}>
              {t('common.allow')}
            </button>
          }
        >
          {t('status.noAccessHint')}
        </Callout>
      )}

      <div className="tabs" role="tablist" aria-label={app.name}>
        <a role="tab" className="tabs__tab" aria-selected={tab === 'accounts'} href={`#/apps/${app.id}`}>
          {t('apps.tabAccounts')} <span className="tabs__count">{accounts.length}</span>
        </a>
        <a role="tab" className="tabs__tab" aria-selected={tab === 'settings'} href={`#/apps/${app.id}/settings`}>
          {t('apps.tabSettings')}
        </a>
      </div>

      {tab === 'accounts' ? (
        <>
          <SeparateTabsCard appId={app.id} />
          <AccountsPanel app={app} accounts={accounts} activeId={active?.id ?? null} canSwitch={granted === true} />
        </>
      ) : (
        <Card
          title={t('apps.access')}
          id="site-access"
          actions={
            granted === false && (
              <button type="button" className="btn btn--primary btn--sm" onClick={() => void allow()}>
                {t('common.allow')}
              </button>
            )
          }
        >
          <p className={granted ? 'access-line access-line--ok' : 'access-line'}>
            {granted
              ? t('apps.accessGranted', { domains: app.domains.join(', ') })
              : t('apps.accessMissing', { domains: app.domains.join(', ') })}
          </p>
        </Card>
      )}
      {tab === 'settings' && (
        <Card>
          <AppForm
            key={JSON.stringify(app)}
            initial={appToInput(app)}
            submitLabel={t('form.saveChanges')}
            busy={pending === 'app.update'}
            onSubmit={async (input) => {
              if (await run('app.update', { id: app.id, patch: input })) notify(t('common.saved'));
            }}
          />
        </Card>
      )}
    </div>
  );
}

function AccountsPanel({
  app,
  accounts,
  activeId,
  canSwitch,
}: {
  app: AppDef;
  accounts: Account[];
  activeId: string | null;
  canSwitch: boolean;
}) {
  const { t, language } = useI18n();
  const askBeforeSwitch = useAskBeforeSwitch();
  const askBeforeLaneClose = useAskBeforeLaneClose();
  const { data, run, pending, requireUnlock } = useManager();
  const notify = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Account | null>(null);
  const [sharing, setSharing] = useState<Account | null>(null);
  const [filter, setFilter] = useState('');
  const listRef = useRef<HTMLUListElement>(null);
  const ids = useMemo(() => accounts.map((account) => account.id), [accounts]);
  const previous = usePreviousSessions(ids);
  const locked = Boolean(data.state.vault && !data.unlocked);
  const filtering = accounts.length > FILTER_FROM && filter.trim() !== '';
  const matching = filtering ? new Set(rankAccounts([app], accounts, filter).map((item) => item.account.id)) : null;
  const shown = matching ? accounts.filter((account) => matching.has(account.id)) : accounts;

  /** Separate tab: open the account in one (not the one the browser's tabs use), or show/close its tabs. */
  const laneItems = (account: Account, isActive: boolean): MenuItem[] => {
    const lane = data.lanes.find((item) => item.accountId === account.id);
    if (lane) {
      return [
        { kind: 'separator' },
        { label: t('lane.show'), icon: <AppWindow />, onSelect: () => void run('lane.focus', { token: lane.token }) },
        {
          label: t('lane.close'),
          icon: <X />,
          hint: t('lane.closeHint'),
          onSelect: async () => {
            if (await askBeforeLaneClose(lane)) await run('lane.close', { token: lane.token });
          },
        },
      ];
    }
    if (isActive || !account.capturedAt || !canSwitch) return [];
    return [
      { kind: 'separator' },
      {
        label: t('lane.open'),
        icon: <AppWindow />,
        onSelect: async () => {
          if (!(await requireUnlock())) return;
          if (account.important) {
            const go = await askBeforeSwitch({
              kind: 'account',
              label: account.label,
              app: app.name,
              important: [`${app.name}: ${account.label}`],
              confirmAll: false,
              appIds: [],
            });
            if (!go) return;
          }
          await run('lane.open', { appId: app.id, accountId: account.id }, `lane:${account.id}`);
        },
      },
    ];
  };

  // With many accounts, the one in use may be far down the page: bring it into view on arrival.
  useEffect(() => {
    if (!activeId) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-account="${CSS.escape(activeId)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  if (accounts.length === 0) {
    return (
      <Callout
        tone="brand"
        title={t('apps.firstAccountTitle', { app: app.name })}
        actions={
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={() => void chrome.tabs.create({ url: app.homeUrl })}
          >
            <ExternalLink /> {t('apps.open', { app: app.name })}
          </button>
        }
      >
        {t('apps.firstAccountBody', { app: app.name })}
      </Callout>
    );
  }

  return (
    <>
      {locked && (
        <Callout
          tone="info"
          title={t('vault.locked')}
          actions={
            <button type="button" className="btn btn--sm" onClick={() => void requireUnlock()}>
              <LockOpen /> {t('common.unlock')}
            </button>
          }
        >
          {t('vault.lockedHint')}
        </Callout>
      )}
      {accounts.length > FILTER_FROM && (
        <div className="input-with-icon account-filter">
          <Search aria-hidden="true" />
          <input
            className="input"
            type="search"
            value={filter}
            aria-label={t('apps.filterAccounts')}
            placeholder={t('apps.filterPlaceholder')}
            onChange={(event) => setFilter(event.target.value)}
          />
        </div>
      )}
      {filtering && shown.length === 0 && <p className="muted">{t('apps.filterEmpty', { query: filter.trim() })}</p>}
      <ul className="account-cards" aria-label={t('apps.accountsHeading')} ref={listRef}>
        {shown.map((account) => {
          const index = accounts.indexOf(account);
          const isActive = account.id === activeId;
          const stats = account.stats;
          const session = stats
            ? stats.databases
              ? t('account.sessionInfoDb', {
                  cookies: stats.cookies,
                  keys: stats.storageKeys,
                  dbs: stats.databases,
                  size: formatBytes(stats.bytes, language),
                })
              : t('account.sessionInfo', {
                  cookies: stats.cookies,
                  keys: stats.storageKeys,
                  size: formatBytes(stats.bytes, language),
                })
            : null;
          return (
            <li
              key={account.id}
              className={`account-card${isActive ? ' account-card--active' : ''}`}
              data-account={account.id}
            >
              <div className="account-card__main">
                <Avatar account={account} size="lg" />
                <div className="account-card__text">
                  <div className="account-card__title">
                    <strong className="truncate">{account.label}</strong>
                    {account.important && (
                      <span className="flag-important">
                        <TriangleAlert aria-hidden="true" />
                        {t('account.importantTag')}
                      </span>
                    )}
                    <ExpiredFlag account={account} />
                    <LaneFlag lane={data.lanes.find((lane) => lane.accountId === account.id)} />
                    {isActive && <span className="seal">{t('account.inUse')}</span>}
                  </div>
                  <span className="muted truncate">
                    {[account.email, account.name !== account.label ? account.name : null]
                      .filter(Boolean)
                      .join(' · ') || t('account.unknownIdentity')}
                  </span>
                  <span className="account-card__ws">
                    <WorkspaceTags account={account} workspaces={data.state.workspaces} max={3} />
                  </span>
                  {account.note && <span className="account-card__note">{account.note}</span>}
                  <span className="account-card__meta">
                    {account.capturedAt
                      ? `${t('account.saved', { time: relativeTime(account.capturedAt, language) })}${session ? ` · ${session}` : ''}`
                      : t('account.noSession')}
                  </span>
                  {account.expiredAt && (
                    <span className="account-card__meta account-card__meta--warning">
                      {t('account.expiredHint', { time: relativeTime(account.expiredAt, language) })}
                    </span>
                  )}
                  {(account.lastUsedAt || !isActive) && (
                    <span className="account-card__meta">
                      {account.lastUsedAt
                        ? t('account.lastUsed', { time: relativeTime(account.lastUsedAt, language) })
                        : t('account.neverUsed')}
                      {account.switchCount > 0 && ` · ${t('account.switchCount', { n: account.switchCount })}`}
                    </span>
                  )}
                </div>
                <div className="account-card__actions">
                  <button
                    type="button"
                    className={`btn btn--sm ${isActive ? '' : 'btn--primary'}`}
                    disabled={!canSwitch || !account.capturedAt || pending === `switch:${account.id}`}
                    onClick={async () => {
                      // Locked: the passphrase first, right here, then the switch goes on.
                      if (!(await requireUnlock())) return;
                      const go = await askBeforeSwitch({
                        kind: 'account',
                        label: account.label,
                        app: app.name,
                        important: account.important && !isActive ? [`${app.name}: ${account.label}`] : [],
                        confirmAll: data.state.settings.confirmSwitch && !isActive,
                        appIds: [app.id],
                      });
                      if (!go) return;
                      const outcome = await run(
                        'switch',
                        { appId: app.id, accountId: account.id, focus: true },
                        `switch:${account.id}`,
                      );
                      if (outcome) notify(t('popup.switched', { label: account.label }));
                    }}
                  >
                    {pending === `switch:${account.id}` ? (
                      <Spinner />
                    ) : isActive ? (
                      <ExternalLink />
                    ) : (
                      <ArrowLeftRight />
                    )}
                    {isActive ? t('common.open') : t('apps.switchHere')}
                  </button>
                  {account.expiredAt && (
                    <button
                      type="button"
                      className="btn btn--sm"
                      disabled={!canSwitch || pending === `fresh:${account.id}`}
                      onClick={async () => {
                        const go = await askBeforeSwitch({
                          kind: 'fresh',
                          label: app.name,
                          app: app.name,
                          important: [],
                          confirmAll: data.state.settings.confirmSwitch,
                          appIds: [app.id],
                        });
                        if (!go) return;
                        const outcome = await run('fresh', { appId: app.id, focus: true }, `fresh:${account.id}`);
                        if (outcome) notify(t('move.signInStarted', { label: account.label }), 'info');
                      }}
                    >
                      {pending === `fresh:${account.id}` ? <Spinner /> : <LogIn />} {t('account.signInAgain')}
                    </button>
                  )}
                  <button type="button" className="btn btn--sm" onClick={() => setEditing(account)}>
                    <Pencil /> {t('common.edit')}
                  </button>
                  <MenuButton
                    label={`${t('common.more')}: ${account.label}`}
                    icon={<Ellipsis />}
                    items={[
                      {
                        label: t('apps.moveUp'),
                        icon: <ArrowUp />,
                        disabled: index === 0,
                        onSelect: () =>
                          void run('account.reorder', { appId: app.id, ids: moveId(ids, index, index - 1) }),
                      },
                      {
                        label: t('apps.moveDown'),
                        icon: <ArrowDown />,
                        disabled: index === accounts.length - 1,
                        onSelect: () =>
                          void run('account.reorder', { appId: app.id, ids: moveId(ids, index, index + 1) }),
                      },
                      ...laneItems(account, isActive),
                      ...(account.capturedAt
                        ? [{ label: t('share.menu'), icon: <Send />, onSelect: () => setSharing(account) }]
                        : []),
                      // Only when there is an earlier session to go back to.
                      ...(previous.has(account.id)
                        ? [
                            {
                              label: t('account.restorePrevious'),
                              icon: <RotateCcw />,
                              onSelect: async () => {
                                if (await run('restorePrevious', { accountId: account.id }))
                                  notify(t('account.restoredPrevious'), 'info');
                              },
                            },
                          ]
                        : []),
                      { kind: 'separator' },
                      {
                        label: t('account.delete'),
                        icon: <Trash2 />,
                        danger: true,
                        onSelect: async () => {
                          if (
                            await confirm({
                              title: t('account.delete'),
                              body: t('account.deleteConfirm', { label: account.label }),
                              confirmLabel: t('common.delete'),
                              danger: true,
                            })
                          ) {
                            await run('account.remove', { id: account.id });
                          }
                        },
                      },
                    ]}
                  />
                </div>
              </div>
              {(account.pins.length > 0 || account.recents.length > 0) && (
                <div className="account-card__links">
                  {account.pins.length > 0 && (
                    <div className="link-group">
                      <span className="link-group__label">{t('account.pins')}</span>
                      {account.pins.map((pin) => (
                        <span key={pin.id} className="chip chip--removable" title={displayUrl(pin.url)}>
                          <Pin aria-hidden="true" />
                          <span className="truncate">{pin.title}</span>
                          <button
                            type="button"
                            aria-label={`${t('common.remove')}: ${pin.title}`}
                            onClick={() => void run('account.unpin', { id: account.id, pinId: pin.id })}
                          >
                            <X />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  {account.recents.length > 0 && (
                    <div className="link-group">
                      <span className="link-group__label">{t('account.recents')}</span>
                      {account.recents.map((recent) => (
                        <span key={recent.key} className="chip" title={displayUrl(recent.url)}>
                          <span className="truncate">{recent.title}</span>
                        </span>
                      ))}
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => void run('account.clearRecents', { id: account.id })}
                      >
                        {t('account.clearRecents')}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {sharing && (
        <ShareDialog
          open
          onClose={() => setSharing(null)}
          scope={{ accountId: sharing.id }}
          name={`${app.name} · ${sharing.label}`}
        />
      )}
      {editing && (
        <AccountEditor
          account={editing}
          open
          busy={pending === 'account.update'}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            if (await run('account.update', { id: editing.id, patch })) {
              setEditing(null);
              notify(t('common.saved'));
            }
          }}
        />
      )}
    </>
  );
}
