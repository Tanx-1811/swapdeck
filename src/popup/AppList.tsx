import { ChevronRight, TriangleAlert } from 'lucide-react';
import { useRef } from 'react';
import type { AppDef } from '../core/types';
import { AppIcon, Avatar } from '../ui/Avatar';
import { useI18n } from '../ui/i18n';
import { useSwitcher } from './context';

/** Every app with the account it uses now; the current tab's app comes first. */
export function AppList({
  apps,
  selectedId,
  onSelect,
  chevrons = false,
}: {
  apps: AppDef[];
  selectedId: string | null;
  onSelect: (appId: string) => void;
  chevrons?: boolean;
}) {
  const { t } = useI18n();
  const { data, probe } = useSwitcher();
  const listRef = useRef<HTMLDivElement>(null);
  const { state, live } = data;
  const ordered = [...apps].sort((a, b) => Number(b.id === probe.appId) - Number(a.id === probe.appId));

  return (
    <div
      className="app-list"
      ref={listRef}
      role="list"
      aria-label={t('popup.yourApps')}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        const rows = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('.app-row') ?? [])];
        const index = rows.indexOf(document.activeElement as HTMLButtonElement);
        if (index === -1) return;
        event.preventDefault();
        rows[(index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length]?.focus();
      }}
    >
      {ordered.map((app) => {
        const accounts = state.accounts.filter((account) => account.appId === app.id);
        const active = accounts.find((account) => account.id === state.active[app.id]);
        const current = app.id === probe.appId;
        const warn = live[app.id]?.mismatch;
        return (
          <div key={app.id} role="listitem">
            <button
              type="button"
              className={`app-row${selectedId === app.id ? ' app-row--selected' : ''}`}
              aria-current={selectedId === app.id ? 'true' : undefined}
              onClick={() => onSelect(app.id)}
            >
              <AppIcon app={app} />
              <span className="app-row__text">
                <span className="app-row__name">
                  <span className="truncate">{app.name}</span>
                  {current && <span className="pill pill--brand">{t('popup.thisTab')}</span>}
                </span>
                <span className="app-row__meta truncate">
                  {active
                    ? `${active.label}${active.email && active.email !== active.label ? ` · ${active.email}` : ''}`
                    : accounts.length
                      ? t('apps.activeNone')
                      : t('apps.noAccounts')}
                </span>
              </span>
              {warn && <TriangleAlert className="app-row__warn" aria-label={t('badge.mismatch', { app: app.name })} />}
              {active && <Avatar account={active} size="sm" />}
              {chevrons && <ChevronRight className="app-row__chevron" aria-hidden="true" />}
            </button>
          </div>
        );
      })}
    </div>
  );
}
