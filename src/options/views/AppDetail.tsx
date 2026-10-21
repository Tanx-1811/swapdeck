import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  Ellipsis,
  ExternalLink,
  Pencil,
  Pin,
  RotateCcw,
  Trash2,
  TriangleAlert,
  UserPlus,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { displayUrl } from '../../core/domains';
import type { Account, AppDef } from '../../core/types';
import { formatBytes, relativeTime } from '../../i18n/translate';
import { appToInput } from '../../shared/apps';
import { hasAccess, onAccessChange, requestAccess } from '../../ui/access';
import { AccountEditor } from '../../ui/AccountEditor';
import { useAskBeforeSwitch } from '../../ui/askBeforeSwitch';
import { AppIcon, Avatar } from '../../ui/Avatar';
import { Callout, MenuButton, Spinner, useConfirm, useToast } from '../../ui/controls';
import { useI18n } from '../../ui/i18n';
import { useManager } from '../context';
import { Card } from '../Options';
import { navigate } from '../router';
import { moveId } from './Apps';
import { AppForm } from './AppForm';

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
      <nav className="breadcrumb" aria-label="Breadcrumb">
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
                confirmAll: false,
                appIds: [app.id],
              });
              if (!go) return;
              const outcome = await run('fresh', { appId: app.id, focus: true }, 'fresh');
              if (outcome) notify(t('toast.freshTitle', { app: app.name }), 'info');
            }}
          >
            {pending === 'fresh' ? <Spinner /> : <UserPlus />} {t('popup.newLogin')}
          </button>
          <MenuButton
            label={t('common.more')}
            icon={<Ellipsis />}
            className="btn btn--icon"
            items={[{ label: t('apps.remove'), icon: <Trash2 />, danger: true, onSelect: () => void removeApp() }]}
          />
        </div>
      </header>

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
        <AccountsPanel app={app} accounts={accounts} activeId={active?.id ?? null} canSwitch={granted === true} />
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
  const { data, run, pending } = useManager();
  const notify = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Account | null>(null);
  const ids = accounts.map((account) => account.id);
  const locked = Boolean(data.state.vault && !data.unlocked);

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
            <a className="btn btn--sm" href="#/security">
              {t('common.unlock')}
            </a>
          }
        >
          {t('vault.lockedHint')}
        </Callout>
      )}
      <ul className="account-cards" aria-label={t('apps.accountsHeading')}>
        {accounts.map((account, index) => {
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
            <li key={account.id} className={`account-card${isActive ? ' account-card--active' : ''}`}>
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
                    {isActive && <span className="seal">{t('account.inUse')}</span>}
                  </div>
                  <span className="muted truncate">
                    {[account.email, account.name !== account.label ? account.name : null]
                      .filter(Boolean)
                      .join(' · ') || t('account.unknownIdentity')}
                  </span>
                  {account.note && <span className="account-card__note">{account.note}</span>}
                  <span className="account-card__meta">
                    {account.capturedAt
                      ? `${t('account.saved', { time: relativeTime(account.capturedAt, language) })}${session ? ` · ${session}` : ''}`
                      : t('account.noSession')}
                  </span>
                  <span className="account-card__meta">
                    {account.lastUsedAt
                      ? t('account.lastUsed', { time: relativeTime(account.lastUsedAt, language) })
                      : t('account.neverUsed')}
                    {account.switchCount > 0 && ` · ${t('account.switchCount', { n: account.switchCount })}`}
                  </span>
                </div>
                <div className="account-card__actions">
                  <button
                    type="button"
                    className={`btn btn--sm ${isActive ? '' : 'btn--primary'}`}
                    disabled={!canSwitch || !account.capturedAt || pending === `switch:${account.id}`}
                    onClick={async () => {
                      const go = await askBeforeSwitch({
                        kind: 'account',
                        label: account.label,
                        app: app.name,
                        important: account.important && !isActive ? [`${app.name}: ${account.label}`] : [],
                        confirmAll: false,
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
                      {
                        label: t('account.restorePrevious'),
                        icon: <RotateCcw />,
                        onSelect: async () => {
                          if (await run('restorePrevious', { accountId: account.id }))
                            notify(t('account.restoredPrevious'), 'info');
                        },
                      },
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
