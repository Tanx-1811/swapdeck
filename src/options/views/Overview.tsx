import { ArrowLeftRight, ArrowRight, Plus } from 'lucide-react';
import { useState } from 'react';
import { findPreset } from '../../core/presets';
import { relativeTime } from '../../i18n/translate';
import { presetToInput } from '../../shared/apps';
import { requestAccess } from '../../ui/access';
import { AppIcon, Avatar } from '../../ui/Avatar';
import { Spinner, useToast } from '../../ui/controls';
import { useI18n } from '../../ui/i18n';
import { Reminders } from '../../ui/Reminders';
import { useManager } from '../context';
import { DeckArt } from '../DeckArt';
import { Card } from '../Options';
import { navigate } from '../router';
import { HistoryLine } from './History';
import { ReloginCard } from './Relogin';
import { useWorkspaceSwitch } from './Workspaces';
import { WorkspaceBadge } from '../../popup/WorkspaceBar';
import { suggestWorkspaces, workspaceStatus } from '../../core/workspaces';

const WEEK_MS = 7 * 24 * 3600 * 1000;

export function Overview() {
  const { t, language } = useI18n();
  const { data, run } = useManager();
  const notify = useToast();
  const { state } = data;
  const welcome = new URLSearchParams(location.search).has('welcome');
  const [weekAgo] = useState(() => Date.now() - WEEK_MS);
  const switches = state.history.filter((entry) => entry.ok && entry.kind === 'switch' && entry.at > weekAgo).length;
  const hasSupabase = state.apps.some((app) => app.presetId === 'supabase');

  const addSupabase = async () => {
    const preset = findPreset('supabase')!;
    if (!(await requestAccess(preset))) {
      notify(t('add.denied'), 'error');
      return;
    }
    const app = await run('app.add', { app: presetToInput(preset) });
    if (app) {
      notify(t('add.addedToast', { app: app.name }));
      navigate(`#/apps/${app.id}`);
    }
  };

  return (
    <div className="stack">
      <section className="hero">
        <div className="hero__text">
          <p className="hero__eyebrow">
            {welcome || state.apps.length === 0 ? t('overview.welcome') : t('app.tagline')}
          </p>
          <h1 className="hero__title">{t('overview.title')}</h1>
          <p className="hero__lead">{t('overview.lead')}</p>
        </div>
        <div className="hero__stats">
          <div className="stat">
            <span className="stat__value">{state.apps.length}</span>
            <span className="stat__label">{t('overview.statApps')}</span>
          </div>
          <div className="stat">
            <span className="stat__value">{state.accounts.length}</span>
            <span className="stat__label">{t('overview.statAccounts')}</span>
          </div>
          <div className="stat">
            <span className="stat__value">{switches}</span>
            <span className="stat__label">{t('overview.statSwitches')}</span>
          </div>
        </div>
        <DeckArt seal={t('account.inUse')} />
      </section>

      <Reminders
        settings={state.settings}
        vault={state.vault}
        accounts={state.accounts}
        onOpenSecurity={() => navigate('#/security')}
      />
      <ReloginCard />

      {(state.accounts.length < 2 || welcome) && (
        <Card title={t('overview.getStarted')} id="get-started">
          <ol className="steps">
            <li className={`step${state.apps.length ? ' step--done' : ''}`}>
              <span className="step__number">1</span>
              <div className="step__body">
                <p>{t('overview.step1')}</p>
                {!hasSupabase && (
                  <div className="row">
                    <button type="button" className="btn btn--primary" onClick={() => void addSupabase()}>
                      <Plus /> {t('overview.step1Action')}
                    </button>
                    <a className="btn btn--ghost" href="#/add">
                      {t('overview.addApp')} <ArrowRight />
                    </a>
                  </div>
                )}
              </div>
            </li>
            <li className={`step${state.accounts.length ? ' step--done' : ''}`}>
              <span className="step__number">2</span>
              <div className="step__body">
                <p>{t('overview.step2')}</p>
              </div>
            </li>
            <li className={`step${state.accounts.length > 1 ? ' step--done' : ''}`}>
              <span className="step__number">3</span>
              <div className="step__body">
                <p>{t('overview.step3')}</p>
              </div>
            </li>
          </ol>
        </Card>
      )}

      {state.apps.length > 0 && (
        <Card
          title={t('overview.yourApps')}
          id="your-apps"
          actions={
            <a className="btn btn--sm" href="#/add">
              <Plus /> {t('apps.add')}
            </a>
          }
        >
          <div className="app-grid">
            {state.apps.map((app) => {
              const accounts = state.accounts.filter((account) => account.appId === app.id);
              const active = accounts.find((account) => account.id === state.active[app.id]);
              return (
                <a key={app.id} className="app-tile" href={`#/apps/${app.id}`}>
                  <div className="app-tile__head">
                    <AppIcon app={app} size="lg" />
                    <div className="truncate">
                      <strong>{app.name}</strong>
                      <span className="muted truncate">{app.domains.join(', ')}</span>
                    </div>
                  </div>
                  <div className="app-tile__foot">
                    <span className="avatar-stack">
                      {accounts.slice(0, 5).map((account) => (
                        <Avatar key={account.id} account={account} size="sm" />
                      ))}
                    </span>
                    <span className="muted truncate">
                      {active
                        ? `${t('account.inUse')}: ${active.label}`
                        : accounts.length
                          ? t('apps.activeNone')
                          : t('apps.noAccounts')}
                    </span>
                  </div>
                </a>
              );
            })}
          </div>
        </Card>
      )}

      {state.apps.length > 0 && <WorkspacesCard />}

      <div className="two-columns">
        <Card
          title={t('overview.recent')}
          id="recent"
          actions={
            state.history.length > 0 && (
              <a className="btn btn--ghost btn--sm" href="#/history">
                {t('nav.history')} <ArrowRight />
              </a>
            )
          }
        >
          {state.history.length === 0 ? (
            <p className="muted">{t('overview.noActivity')}</p>
          ) : (
            <ul className="activity">
              {state.history.slice(0, 6).map((entry) => (
                <li key={entry.id}>
                  <HistoryLine entry={entry} />
                  <span className="muted">{relativeTime(entry.at, language)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={t('overview.tips')} id="tips">
          <ul className="shortcuts">
            <li>
              <span>{t('overview.tipPopup')}</span>
              <span>
                <kbd>Alt</kbd> <kbd>Shift</kbd> <kbd>A</kbd>
              </span>
            </li>
            <li>
              <span>{t('overview.tipNext')}</span>
              <span>
                <kbd>Alt</kbd> <kbd>Shift</kbd> <kbd>S</kbd>
              </span>
            </li>
            <li>
              <span>{t('overview.tipOmnibox', { keyword: 'swd' })}</span>
              <span>
                <kbd>swd</kbd> <kbd>␣</kbd>
              </span>
            </li>
          </ul>
        </Card>
      </div>
    </div>
  );
}

function WorkspacesCard() {
  const { t } = useI18n();
  const { data, pending } = useManager();
  const switchWorkspace = useWorkspaceSwitch();
  const { state } = data;
  const suggestions = suggestWorkspaces(state.apps, state.accounts, state.workspaces, t('workspaces.personal'));
  return (
    <Card
      title={t('workspaces.title')}
      lead={t('workspaces.overviewLead')}
      id="workspaces"
      actions={
        <a className="btn btn--sm" href="#/workspaces">
          {t('common.manage')} <ArrowRight />
        </a>
      }
    >
      {state.workspaces.length === 0 ? (
        <div className="row">
          <p className="muted grow">
            {suggestions.length
              ? t('workspaces.suggestionsReady', { n: suggestions.length })
              : t('workspaces.emptyBody')}
          </p>
          <a className="btn btn--primary btn--sm" href="#/workspaces">
            <Plus /> {suggestions.length ? t('workspaces.seeSuggestions') : t('workspaces.new')}
          </a>
        </div>
      ) : (
        <div className="workspace-mini-grid">
          {state.workspaces.map((workspace) => {
            const status = workspaceStatus(workspace, state.apps, state.accounts, state.active);
            return (
              <div key={workspace.id} className={`workspace-mini workspace-mini--${status.state}`}>
                <WorkspaceBadge workspace={workspace} size={32} />
                <div className="workspace-mini__text">
                  <strong className="truncate">{workspace.name}</strong>
                  <span className="muted truncate">
                    {status.state === 'active'
                      ? t('workspaces.inUse')
                      : status.state === 'partial'
                        ? t('workspaces.partial', { n: status.matched, total: status.total })
                        : t('workspaces.appCount', { n: status.total })}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn--sm"
                  disabled={status.total === 0 || status.state === 'active' || pending !== null}
                  onClick={() => void switchWorkspace(workspace)}
                >
                  {pending === `ws:${workspace.id}` ? <Spinner /> : <ArrowLeftRight />}
                  <span className="visually-hidden">{workspace.name}</span> {t('apps.switchHere')}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
