import { ArrowDown, ArrowRight, ArrowUp, ChevronRight, GripVertical, Layers, Plus } from 'lucide-react';
import { useState } from 'react';
import { findPreset } from '../../core/presets';
import { AppIcon, Avatar } from '../../ui/Avatar';
import { Spinner } from '../../ui/controls';
import { useI18n } from '../../ui/i18n';
import { useManager } from '../context';
import { PageHeader } from '../Options';
import { STARTER_PRESETS, useAddPreset } from './AddApp';

/** Reorders by moving `from` to `to` in a list of ids. */
export function moveId(ids: readonly string[], from: number, to: number): string[] {
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  if (moved !== undefined) next.splice(Math.max(0, Math.min(next.length, to)), 0, moved);
  return next;
}

export function Apps() {
  const { t } = useI18n();
  const { data, run, pending } = useManager();
  const { state } = data;
  const addPreset = useAddPreset();
  const [dragging, setDragging] = useState<number | null>(null);
  const ids = state.apps.map((app) => app.id);
  const reorder = (from: number, to: number) => {
    if (from !== to) void run('app.reorder', { ids: moveId(ids, from, to) });
  };

  return (
    <div className="stack">
      <PageHeader
        title={t('apps.title')}
        lead={state.apps.length > 1 ? `${t('apps.lead')} ${t('apps.leadReorder')}` : t('apps.lead')}
        actions={
          state.apps.length > 0 && (
            <a className="btn btn--primary" href="#/add">
              <Plus /> {t('apps.add')}
            </a>
          )
        }
      />
      {state.apps.length === 0 ? (
        <div className="empty-card">
          <Layers className="empty-card__icon" aria-hidden="true" />
          <strong>{t('apps.empty')}</strong>
          <p>{t('apps.emptyBody')}</p>
          <div className="starter-grid">
            {STARTER_PRESETS.map(findPreset)
              .filter((preset) => preset !== undefined)
              .map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className="starter"
                  disabled={pending !== null}
                  onClick={() => void addPreset(preset)}
                >
                  {pending === `add:${preset.id}` ? <Spinner /> : <AppIcon app={preset} favicon={false} />}
                  <span>{preset.name}</span>
                </button>
              ))}
          </div>
          <a className="btn" href="#/add">
            {t('apps.browseAll')} <ArrowRight />
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
                      {t('apps.accounts', { n: accounts.length })}
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
