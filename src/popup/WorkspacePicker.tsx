import { Settings2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { rankWorkspaces } from '../core/search';
import { workspaceStatus } from '../core/workspaces';
import { Dialog, Spinner } from '../ui/controls';
import { useI18n } from '../ui/i18n';
import { useSwitcher } from './context';
import { WorkspaceBadge } from './WorkspaceBar';

/**
 * Every workspace in a searchable list: what the header pill and the bar's
 * "All" button open, so a long list of clients stays one keystroke away.
 */
export function WorkspacePicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onClose={onClose} title={t('workspaces.pickTitle')}>
      {open && <PickerBody onClose={onClose} />}
    </Dialog>
  );
}

function PickerBody({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { data, busy, switchWorkspace, openManager } = useSwitcher();
  const { state, progress } = data;
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLUListElement>(null);
  const workspaces = useMemo(
    () => (query.trim() ? rankWorkspaces(state.workspaces, query) : state.workspaces),
    [state.workspaces, query],
  );

  const rows = () => [...(listRef.current?.querySelectorAll<HTMLButtonElement>('.picker-row:not(:disabled)') ?? [])];
  const choose = (index: number) => {
    const workspace = workspaces[index];
    if (!workspace) return;
    onClose();
    void switchWorkspace(workspace);
  };

  return (
    <div className="picker">
      <input
        className="input"
        type="search"
        value={query}
        data-autofocus
        aria-label={t('workspaces.pickSearch')}
        placeholder={`${t('workspaces.pickSearch')}…`}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            rows()[0]?.focus();
          } else if (event.key === 'Enter' && query.trim()) {
            event.preventDefault();
            const first = workspaces.findIndex(
              (workspace) => workspaceStatus(workspace, state.apps, state.accounts, state.active).total > 0,
            );
            if (first !== -1) choose(first);
          }
        }}
      />
      {workspaces.length === 0 ? (
        <p className="muted picker__empty">{t('workspaces.pickEmpty', { query })}</p>
      ) : (
        <ul
          ref={listRef}
          className="picker__list"
          aria-label={t('workspaces.title')}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            const list = rows();
            const index = list.indexOf(document.activeElement as HTMLButtonElement);
            if (index === -1) return;
            event.preventDefault();
            const next = index + (event.key === 'ArrowDown' ? 1 : -1);
            if (next < 0) listRef.current?.closest('.picker')?.querySelector<HTMLInputElement>('input')?.focus();
            else list[Math.min(next, list.length - 1)]?.focus();
          }}
        >
          {workspaces.map((workspace, index) => {
            const status = workspaceStatus(workspace, state.apps, state.accounts, state.active);
            const switching = busy === `ws:${workspace.id}` || progress?.workspaceId === workspace.id;
            return (
              <li key={workspace.id}>
                <button
                  type="button"
                  className={`picker-row picker-row--${status.state}`}
                  disabled={busy !== null || status.total === 0}
                  aria-current={status.state === 'active' ? 'true' : undefined}
                  onClick={() => choose(index)}
                >
                  <WorkspaceBadge workspace={workspace} size={26} />
                  <span className="picker-row__text">
                    <span className="picker-row__name">
                      <span className="visually-hidden">{t('workspaces.switchPrefix')} </span>
                      <span className="truncate">{workspace.name}</span>
                    </span>
                    <span className="muted truncate">
                      {status.state === 'partial'
                        ? t('workspaces.partial', { n: status.matched, total: status.total })
                        : t('workspaces.appCount', { n: status.total })}
                    </span>
                  </span>
                  {switching ? (
                    <Spinner />
                  ) : (
                    status.state === 'active' && <span className="seal">{t('workspaces.inUse')}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="picker__footer">
        <button
          type="button"
          className="link-button"
          onClick={() => {
            onClose();
            openManager('#/workspaces');
          }}
        >
          <Settings2 aria-hidden="true" /> {t('workspaces.manage')}
        </button>
      </div>
    </div>
  );
}
