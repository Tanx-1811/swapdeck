import { Check, Layers, Plus, Settings2 } from 'lucide-react';
import { useState } from 'react';
import type { Workspace } from '../core/types';
import { readableTextColor } from '../core/util';
import { workspaceStatus } from '../core/workspaces';
import { Dialog, Field, MenuButton, Spinner, useToast } from '../ui/controls';
import { SymbolIcon } from '../ui/icons';
import { useI18n } from '../ui/i18n';
import { useSwitcher } from './context';

export function WorkspaceBadge({
  workspace,
  size = 22,
}: {
  workspace: Pick<Workspace, 'name' | 'color' | 'emoji'> & { icon?: string };
  size?: number;
}) {
  const solid = !workspace.icon && workspace.emoji;
  return (
    <span
      className="ws-badge"
      style={{
        width: size,
        height: size,
        background: solid ? `${workspace.color}24` : workspace.color,
        color: readableTextColor(workspace.color),
        fontSize: solid ? size * 0.62 : size * 0.5,
      }}
      aria-hidden="true"
    >
      {workspace.icon ? (
        <SymbolIcon name={workspace.icon} size={Math.round(size * 0.58)} />
      ) : (
        (workspace.emoji ?? Array.from(workspace.name)[0]?.toUpperCase())
      )}
    </span>
  );
}

/** One click switches every app of a workspace (VI: "bên"). */
export function WorkspaceBar() {
  const { t } = useI18n();
  const notify = useToast();
  const { data, busy, switchWorkspace, openManager, run } = useSwitcher();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const { state, progress } = data;
  const hasActive = Object.values(state.active).some(Boolean);

  return (
    <div className="ws-bar" role="group" aria-label={t('workspaces.title')}>
      <span className="ws-bar__label">
        <Layers aria-hidden="true" /> {t('workspaces.short')}
      </span>
      <div className="ws-bar__chips">
        {state.workspaces.map((workspace) => {
          const status = workspaceStatus(workspace, state.apps, state.accounts, state.active);
          const switching = busy === `ws:${workspace.id}` || progress?.workspaceId === workspace.id;
          return (
            <button
              key={workspace.id}
              type="button"
              className={`ws-chip ws-chip--${status.state}`}
              disabled={busy !== null || status.total === 0}
              aria-pressed={status.state === 'active'}
              title={
                status.state === 'active'
                  ? t('workspaces.inUse')
                  : t('workspaces.switchTitle', { name: workspace.name, n: status.total })
              }
              onClick={() => void switchWorkspace(workspace)}
            >
              <WorkspaceBadge workspace={workspace} size={18} />
              <span className="truncate">{workspace.name}</span>
              {switching ? (
                <>
                  <Spinner />
                  {progress && progress.workspaceId === workspace.id && (
                    <span className="ws-chip__count">
                      {progress.done}/{progress.total}
                    </span>
                  )}
                </>
              ) : status.state === 'active' ? (
                <Check className="ws-chip__check" aria-hidden="true" />
              ) : status.state === 'partial' ? (
                <span className="ws-chip__count">
                  {status.matched}/{status.total}
                </span>
              ) : null}
            </button>
          );
        })}
        {state.workspaces.length === 0 && <span className="ws-bar__empty muted">{t('workspaces.barEmpty')}</span>}
      </div>
      <MenuButton
        label={t('workspaces.menu')}
        icon={<Plus />}
        items={[
          {
            label: t('workspaces.fromActive'),
            icon: <Plus />,
            disabled: !hasActive,
            onSelect: () => {
              setName('');
              setNaming(true);
            },
          },
          { label: t('workspaces.manage'), icon: <Settings2 />, onSelect: () => openManager('#/workspaces') },
        ]}
      />
      <Dialog open={naming} onClose={() => setNaming(false)} title={t('workspaces.fromActive')}>
        <form
          className="editor"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!name.trim()) return;
            const workspace = await run('workspace.fromActive', { name: name.trim() });
            if (workspace) {
              setNaming(false);
              notify(t('workspaces.created', { name: workspace.name, n: Object.keys(workspace.members).length }));
            }
          }}
        >
          <p className="dialog__text">{t('workspaces.fromActiveHint')}</p>
          <Field label={t('workspaces.name')} htmlFor="ws-name">
            <input
              id="ws-name"
              className="input"
              value={name}
              autoFocus
              maxLength={80}
              placeholder={t('workspaces.namePlaceholder')}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <div className="dialog__actions">
            <button type="button" className="btn" onClick={() => setNaming(false)}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn--primary" disabled={!name.trim()}>
              {t('common.save')}
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
