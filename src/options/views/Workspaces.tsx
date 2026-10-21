import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  Ellipsis,
  FolderOpen,
  Layers,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useMemo } from 'react';
import type { Workspace } from '../../core/types';
import { relativeTime } from '../../i18n/translate';
import { importantTargets, liveMembers, suggestWorkspaces, workspaceStatus } from '../../core/workspaces';
import { AppIcon } from '../../ui/Avatar';
import { MenuButton, Spinner, useConfirm, useToast } from '../../ui/controls';
import { useI18n } from '../../ui/i18n';
import { WorkspaceBadge } from '../../popup/WorkspaceBar';
import { useManager } from '../context';
import { Card, PageHeader } from '../Options';
import { navigate } from '../router';
import { moveId } from './Apps';

export function useWorkspaceSwitch() {
  const { t } = useI18n();
  const { data, run } = useManager();
  const notify = useToast();
  const confirm = useConfirm();
  return async (workspace: Workspace, open = false) => {
    const { state } = data;
    const important = importantTargets(workspace, state.apps, state.accounts, state.active);
    if (
      important.length > 0 &&
      !(await confirm({
        title: t('workspaces.confirmTitle', { name: workspace.name }),
        body: t('workspaces.confirmImportantBody', { list: important.join(', ') }),
        confirmLabel: t('apps.switchHere'),
        danger: true,
      }))
    ) {
      return;
    }
    const outcome = await run(open ? 'workspace.open' : 'workspace.switch', { id: workspace.id }, `ws:${workspace.id}`);
    if (!outcome) return;
    notify(
      outcome.switched === 0 && outcome.failed === 0
        ? t('workspaces.alreadyInUse', { name: workspace.name })
        : t('workspaces.switched', { name: workspace.name, n: outcome.switched }) +
            (outcome.failed ? ` ${t('workspaces.failedCount', { n: outcome.failed })}` : ''),
      outcome.failed ? 'info' : 'success',
    );
  };
}

/** Members as small chips: app icon and the account used there. */
export function MemberChips({ workspace, max = 8 }: { workspace: Workspace; max?: number }) {
  const { data } = useManager();
  const { state } = data;
  const members = liveMembers(workspace, state.apps, state.accounts);
  return (
    <span className="member-chips">
      {members.slice(0, max).map(([appId, accountId]) => {
        const app = state.apps.find((item) => item.id === appId)!;
        const account = state.accounts.find((item) => item.id === accountId)!;
        const inUse = state.active[appId] === accountId;
        return (
          <span
            key={appId}
            className={`member-chip${inUse ? ' member-chip--on' : ''}`}
            title={`${app.name}: ${account.label}`}
          >
            <AppIcon app={app} size="sm" />
            <span className="truncate">{account.label}</span>
          </span>
        );
      })}
      {members.length > max && <span className="member-chip member-chip--more">+{members.length - max}</span>}
    </span>
  );
}

export function Workspaces() {
  const { t, language } = useI18n();
  const { data, run, pending } = useManager();
  const notify = useToast();
  const confirm = useConfirm();
  const switchWorkspace = useWorkspaceSwitch();
  const { state } = data;
  const suggestions = useMemo(
    () => suggestWorkspaces(state.apps, state.accounts, state.workspaces, t('workspaces.personal')),
    [state.apps, state.accounts, state.workspaces, t],
  );
  const ids = state.workspaces.map((workspace) => workspace.id);
  const hasActive = Object.values(state.active).some(Boolean);

  return (
    <div className="stack">
      <PageHeader
        title={t('workspaces.title')}
        lead={t('workspaces.lead')}
        actions={
          <>
            <button
              type="button"
              className="btn"
              disabled={!hasActive || pending === 'workspace.fromActive'}
              onClick={async () => {
                const workspace = await run('workspace.fromActive', {
                  name: t('workspaces.defaultName', { n: state.workspaces.length + 1 }),
                });
                if (workspace) {
                  notify(t('workspaces.created', { name: workspace.name, n: Object.keys(workspace.members).length }));
                  navigate(`#/workspaces/${workspace.id}`);
                }
              }}
            >
              <Layers /> {t('workspaces.fromActive')}
            </button>
            <a className="btn btn--primary" href="#/workspaces/new">
              <Plus /> {t('workspaces.new')}
            </a>
          </>
        }
      />

      {suggestions.length > 0 && (
        <Card title={t('workspaces.suggestions')} lead={t('workspaces.suggestionsLead')} id="suggestions">
          <div className="suggestions">
            {suggestions.map((suggestion) => (
              <div key={suggestion.key} className="suggestion">
                <Sparkles className="suggestion__icon" aria-hidden="true" />
                <div className="suggestion__text">
                  <strong>{suggestion.name}</strong>
                  <span className="muted">
                    {suggestion.key === 'personal' ? t('workspaces.personalHint') : `@${suggestion.key}`} ·{' '}
                    {t('workspaces.appCount', { n: Object.keys(suggestion.members).length })}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn--soft btn--sm"
                  onClick={async () => {
                    const workspace = await run('workspace.save', {
                      workspace: {
                        name: suggestion.name,
                        color: suggestion.color,
                        members: suggestion.members,
                        links: [],
                      },
                    });
                    if (workspace)
                      notify(
                        t('workspaces.created', { name: workspace.name, n: Object.keys(workspace.members).length }),
                      );
                  }}
                >
                  <Plus /> {t('workspaces.createThis')}
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {state.workspaces.length === 0 ? (
        <div className="empty-card">
          <Layers className="empty-card__icon" aria-hidden="true" />
          <strong>{t('workspaces.emptyTitle')}</strong>
          <p>{t('workspaces.emptyBody')}</p>
          <a className="btn btn--primary" href="#/workspaces/new">
            <Plus /> {t('workspaces.new')}
          </a>
        </div>
      ) : (
        <ul className="workspace-cards" aria-label={t('workspaces.title')}>
          {state.workspaces.map((workspace, index) => {
            const status = workspaceStatus(workspace, state.apps, state.accounts, state.active);
            const switching = pending === `ws:${workspace.id}`;
            return (
              <li key={workspace.id} className={`workspace-card workspace-card--${status.state}`}>
                <div className="workspace-card__head">
                  <WorkspaceBadge workspace={workspace} size={44} />
                  <div className="workspace-card__text">
                    <div className="workspace-card__title">
                      <strong className="truncate">{workspace.name}</strong>
                      {status.state === 'active' && <span className="seal">{t('workspaces.inUse')}</span>}
                      {status.state === 'partial' && (
                        <span className="pill pill--warning">
                          {t('workspaces.partial', { n: status.matched, total: status.total })}
                        </span>
                      )}
                    </div>
                    {workspace.note && <span className="workspace-card__note">{workspace.note}</span>}
                    <span className="muted small">
                      {t('workspaces.appCount', { n: status.total })}
                      {workspace.links.length > 0 && ` · ${t('workspaces.linkCount', { n: workspace.links.length })}`}
                      {workspace.lastUsedAt &&
                        ` · ${t('account.lastUsed', { time: relativeTime(workspace.lastUsedAt, language) })}`}
                    </span>
                  </div>
                  <div className="workspace-card__actions">
                    <button
                      type="button"
                      className="btn btn--primary btn--sm"
                      disabled={status.total === 0 || pending !== null}
                      onClick={() => void switchWorkspace(workspace)}
                    >
                      {switching ? <Spinner /> : <ArrowLeftRight />} {t('apps.switchHere')}
                    </button>
                    {workspace.links.length > 0 && (
                      <button
                        type="button"
                        className="btn btn--sm"
                        disabled={pending !== null}
                        onClick={() => void switchWorkspace(workspace, true)}
                      >
                        <FolderOpen /> {t('workspaces.open')}
                      </button>
                    )}
                    <a className="btn btn--sm" href={`#/workspaces/${workspace.id}`}>
                      <Pencil /> {t('common.edit')}
                    </a>
                    <MenuButton
                      label={`${t('common.more')}: ${workspace.name}`}
                      icon={<Ellipsis />}
                      items={[
                        {
                          label: t('apps.moveUp'),
                          icon: <ArrowUp />,
                          disabled: index === 0,
                          onSelect: () => void run('workspace.reorder', { ids: moveId(ids, index, index - 1) }),
                        },
                        {
                          label: t('apps.moveDown'),
                          icon: <ArrowDown />,
                          disabled: index === state.workspaces.length - 1,
                          onSelect: () => void run('workspace.reorder', { ids: moveId(ids, index, index + 1) }),
                        },
                        { kind: 'separator' },
                        {
                          label: t('workspaces.delete'),
                          icon: <Trash2 />,
                          danger: true,
                          onSelect: async () => {
                            if (
                              await confirm({
                                title: t('workspaces.delete'),
                                body: t('workspaces.deleteConfirm', { name: workspace.name }),
                                confirmLabel: t('common.delete'),
                                danger: true,
                              })
                            ) {
                              await run('workspace.remove', { id: workspace.id });
                            }
                          },
                        },
                      ]}
                    />
                  </div>
                </div>
                <MemberChips workspace={workspace} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
