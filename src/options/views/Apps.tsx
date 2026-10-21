import { ArrowDown, ArrowUp, ChevronRight, GripVertical, Plus } from 'lucide-react';
import { useState } from 'react';
import { AppIcon, Avatar } from '../../ui/Avatar';
import { useI18n } from '../../ui/i18n';
import { useManager } from '../context';
import { PageHeader } from '../Options';

/** Reorders by moving `from` to `to` in a list of ids. */
export function moveId(ids: readonly string[], from: number, to: number): string[] {
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  if (moved !== undefined) next.splice(Math.max(0, Math.min(next.length, to)), 0, moved);
  return next;
}

export function Apps() {
  const { t } = useI18n();
  const { data, run } = useManager();
  const { state } = data;
  const [dragging, setDragging] = useState<number | null>(null);
  const ids = state.apps.map((app) => app.id);
  const reorder = (from: number, to: number) => {
    if (from !== to) void run('app.reorder', { ids: moveId(ids, from, to) });
  };

  return (
    <div className="stack">
      <PageHeader
        title={t('apps.title')}
        lead={t('apps.lead')}
        actions={
          <a className="btn btn--primary" href="#/add">
            <Plus /> {t('apps.add')}
          </a>
        }
      />
      {state.apps.length === 0 ? (
        <div className="empty-card">
          <p>{t('apps.empty')}</p>
          <a className="btn btn--primary" href="#/add">
            <Plus /> {t('apps.add')}
          </a>
        </div>
      ) : (
        <ul className="list-card" aria-label={t('apps.title')}>
          {state.apps.map((app, index) => {
            const accounts = state.accounts.filter((account) => account.appId === app.id);
            const active = accounts.find((account) => account.id === state.active[app.id]);
            return (
              <li
                key={app.id}
                className={`list-row${dragging === index ? ' list-row--dragging' : ''}`}
                draggable
                onDragStart={(event) => {
                  setDragging(index);
                  event.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  if (dragging !== null) reorder(dragging, index);
                  setDragging(null);
                }}
                onDragEnd={() => setDragging(null)}
              >
                <span className="list-row__grip" title={t('apps.dragHandle')} aria-hidden="true">
                  <GripVertical />
                </span>
                <a className="list-row__main" href={`#/apps/${app.id}`}>
                  <AppIcon app={app} size="lg" />
                  <span className="list-row__text">
                    <strong>{app.name}</strong>
                    <span className="muted truncate">{app.domains.join(', ')}</span>
                  </span>
                  <span className="list-row__accounts">
                    <span className="avatar-stack">
                      {accounts.slice(0, 6).map((account) => (
                        <Avatar key={account.id} account={account} size="sm" />
                      ))}
                    </span>
                    <span className="muted">
                      {accounts.length === 1 ? t('apps.oneAccount') : t('apps.accounts', { n: accounts.length })}
                      {active ? ` · ${active.label}` : ''}
                    </span>
                  </span>
                  <ChevronRight className="list-row__chevron" aria-hidden="true" />
                </a>
                <span className="list-row__order">
                  <button
                    type="button"
                    className="btn btn--ghost btn--icon btn--sm"
                    aria-label={`${t('apps.moveUp')}: ${app.name}`}
                    disabled={index === 0}
                    onClick={() => reorder(index, index - 1)}
                  >
                    <ArrowUp />
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--icon btn--sm"
                    aria-label={`${t('apps.moveDown')}: ${app.name}`}
                    disabled={index === state.apps.length - 1}
                    onClick={() => reorder(index, index + 1)}
                  >
                    <ArrowDown />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
