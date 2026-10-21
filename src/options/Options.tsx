import {
  Archive,
  BookOpen,
  History as HistoryIcon,
  LayoutDashboard,
  Layers,
  Lock,
  LockOpen,
  Settings as SettingsIcon,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ErrorCode } from '../shared/protocol';
import { useToast } from '../ui/controls';
import { useAction, type Snapshot } from '../ui/hooks';
import { useI18n } from '../ui/i18n';
import { Logo } from '../ui/Logo';
import { ManagerContext, type Manager } from './context';
import { useRoute, type Route } from './router';
import { AddApp, CustomApp } from './views/AddApp';
import { AppDetail } from './views/AppDetail';
import { Apps } from './views/Apps';
import { Backup } from './views/Backup';
import { Help } from './views/Help';
import { History } from './views/History';
import { Overview } from './views/Overview';
import { Security } from './views/Security';
import { SettingsView } from './views/SettingsView';
import { WorkspaceEditor } from './views/WorkspaceEditor';
import { Workspaces } from './views/Workspaces';

type NavItem = { route: Route['name']; hash: string; label: string; icon: ReactNode; match: Route['name'][] };

export function Options({ data }: { data: Snapshot | null }) {
  const { t } = useI18n();
  const notify = useToast();
  const route = useRoute();
  const [lastError, setLastError] = useState<ErrorCode | null>(null);
  const onError = useCallback(
    (message: string, result: { error: ErrorCode }) => {
      setLastError(result.error);
      notify(message, 'error');
    },
    [notify],
  );
  const { run, pending } = useAction(onError, t);

  useEffect(() => {
    if (data) document.documentElement.dataset.ready = 'true';
  }, [data]);

  useEffect(() => {
    const titles: Partial<Record<Route['name'], string>> = {
      workspaces: t('workspaces.title'),
      workspace: t('workspaces.title'),
      apps: t('nav.apps'),
      app: t('nav.apps'),
      add: t('add.title'),
      custom: t('add.customTitle'),
      history: t('nav.history'),
      backup: t('nav.backup'),
      security: t('nav.security'),
      settings: t('nav.settings'),
      help: t('nav.help'),
    };
    const title = titles[route.name];
    document.title = title ? `${title} — Swapdeck` : 'Swapdeck';
  }, [route, t]);

  const nav: NavItem[] = useMemo(
    () => [
      { route: 'overview', hash: '#/', label: t('nav.overview'), icon: <LayoutDashboard />, match: ['overview'] },
      {
        route: 'workspaces',
        hash: '#/workspaces',
        label: t('nav.workspaces'),
        icon: <Users />,
        match: ['workspaces', 'workspace'],
      },
      {
        route: 'apps',
        hash: '#/apps',
        label: t('nav.apps'),
        icon: <Layers />,
        match: ['apps', 'app', 'add', 'custom'],
      },
      { route: 'history', hash: '#/history', label: t('nav.history'), icon: <HistoryIcon />, match: ['history'] },
      { route: 'backup', hash: '#/backup', label: t('nav.backup'), icon: <Archive />, match: ['backup'] },
      { route: 'security', hash: '#/security', label: t('nav.security'), icon: <ShieldCheck />, match: ['security'] },
      { route: 'settings', hash: '#/settings', label: t('nav.settings'), icon: <SettingsIcon />, match: ['settings'] },
      { route: 'help', hash: '#/help', label: t('nav.help'), icon: <BookOpen />, match: ['help'] },
    ],
    [t],
  );

  if (!data) {
    return (
      <div className="manager manager--loading">
        <span className="spinner" role="status" aria-label={t('common.loading')} />
      </div>
    );
  }

  const manager: Manager = { data, run, pending, lastError };
  const { state, unlocked } = data;

  return (
    <ManagerContext value={manager}>
      <div className="manager">
        <aside className="sidebar">
          <a className="sidebar__brand" href="#/">
            <Logo size={28} />
          </a>
          <nav aria-label={t('nav.main')}>
            <ul className="sidebar__nav">
              {nav.map((item) => (
                <li key={item.route}>
                  <a
                    href={item.hash}
                    className="sidebar__link"
                    aria-current={item.match.includes(route.name) ? 'page' : undefined}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                    {item.route === 'apps' && state.apps.length > 0 && (
                      <span className="sidebar__count">{state.apps.length}</span>
                    )}
                    {item.route === 'workspaces' && state.workspaces.length > 0 && (
                      <span className="sidebar__count">{state.workspaces.length}</span>
                    )}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          {state.vault && (
            <div className="sidebar__vault">
              {unlocked ? <LockOpen aria-hidden="true" /> : <Lock aria-hidden="true" />}
              <span>{unlocked ? t('vault.unlockedShort') : t('vault.lockedShort')}</span>
              {unlocked ? (
                <button type="button" className="link-button" onClick={() => void run('vault.lock', {})}>
                  {t('common.lock')}
                </button>
              ) : (
                <a className="link-button" href="#/security">
                  {t('common.unlock')}
                </a>
              )}
            </div>
          )}
          <p className="sidebar__tagline">{t('app.tagline')}</p>
        </aside>
        <main className="content" id="main">
          {route.name === 'overview' && <Overview />}
          {route.name === 'workspaces' && <Workspaces />}
          {route.name === 'workspace' && <WorkspaceEditor key={route.id ?? 'new'} id={route.id} />}
          {route.name === 'apps' && <Apps />}
          {route.name === 'app' && <AppDetail id={route.id} tab={route.tab} />}
          {route.name === 'add' && <AddApp />}
          {route.name === 'custom' && <CustomApp initialUrl={route.url} />}
          {route.name === 'history' && <History />}
          {route.name === 'backup' && <Backup />}
          {route.name === 'security' && <Security />}
          {route.name === 'settings' && <SettingsView />}
          {route.name === 'help' && <Help />}
        </main>
      </div>
    </ManagerContext>
  );
}

/** Page heading with optional lead text and actions on the right. */
export function PageHeader({ title, lead, actions }: { title: string; lead?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div className="page-header__text">
        <h1>{title}</h1>
        {lead && <p className="page-header__lead">{lead}</p>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </header>
  );
}

export function Card({
  title,
  lead,
  children,
  actions,
  id,
}: {
  title?: string;
  lead?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  id?: string;
}) {
  return (
    <section className="card" aria-labelledby={title && id ? id : undefined}>
      {(title || actions) && (
        <div className="card__header">
          <div>
            {title && (
              <h2 className="card__title" id={id}>
                {title}
              </h2>
            )}
            {lead && <p className="card__lead">{lead}</p>}
          </div>
          {actions && <div className="card__actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
