import { Check, Layers, Plus, Search, Settings2 } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
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

/** Above this many workspaces the bar keeps the few in use or used last, and "All" opens the picker. */
export const WS_BAR_MAX = 6;
const WS_BAR_COLLAPSED = 3;

/** Which edges of a scrolling strip hide chips ("start", "end"), for the fade. */
function useEdgeFade(ref: RefObject<HTMLElement | null>, count: number): string {
  const [fade, setFade] = useState('');
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      const start = element.scrollLeft > 1;
      const end = element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
      setFade([start ? 'start' : '', end ? 'end' : ''].filter(Boolean).join(' '));
    };
    update();
    element.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      element.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [ref, count]);
  return fade;
}

/** One click switches every app of a workspace (VI: "bên"). */
export function WorkspaceBar() {
  const { t } = useI18n();
  const notify = useToast();
  const { data, busy, pending, switchWorkspace, openManager, openPicker, run } = useSwitcher();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const chipsRef = useRef<HTMLDivElement>(null);
  const { state, progress } = data;
  const hasActive = Object.values(state.active).some(Boolean);
  const statuses = new Map(
    state.workspaces.map((workspace) => [
      workspace.id,
      workspaceStatus(workspace, state.apps, state.accounts, state.active),
    ]),
  );
  const collapsed = state.workspaces.length > WS_BAR_MAX;
  // Collapsed: the workspace in use first, then those used last, shown in the user's own order.
  let shown = state.workspaces;
  if (collapsed) {
    const rank = (workspace: Workspace) =>
      (statuses.get(workspace.id)?.state === 'active' ? 1e15 : 0) + (workspace.lastUsedAt ?? 0);
    const keep = new Set(
      [...state.workspaces]
        .sort((a, b) => rank(b) - rank(a))
        .slice(0, WS_BAR_COLLAPSED)
        .map((workspace) => workspace.id),
    );
    shown = state.workspaces.filter((workspace) => keep.has(workspace.id));
  }
  const focusId =
    progress?.workspaceId ?? shown.find((workspace) => statuses.get(workspace.id)?.state === 'active')?.id ?? null;
  const fade = useEdgeFade(chipsRef, shown.length);
  const creating = pending === 'workspace.fromActive';

  // Bring the workspace in use (or the one switching) into view.
  useLayoutEffect(() => {
    const strip = chipsRef.current;
    const chip = focusId ? strip?.querySelector<HTMLElement>(`[data-workspace="${CSS.escape(focusId)}"]`) : null;
    if (!strip || !chip) return;
    const left = chip.offsetLeft - strip.offsetLeft;
    if (left < strip.scrollLeft || left + chip.offsetWidth > strip.scrollLeft + strip.clientWidth) {
      strip.scrollLeft = Math.max(0, left - 24);
    }
  }, [focusId]);

  return (
    <div className="ws-bar" role="group" aria-label={t('workspaces.title')}>
      <span className="ws-bar__label">
        <Layers aria-hidden="true" /> {t('nav.workspaces')}
      </span>
      <div
        ref={chipsRef}
        className="ws-bar__chips"
        data-fade={fade || undefined}
        onWheel={(event) => {
          // A mouse wheel scrolls the strip sideways.
          const strip = event.currentTarget;
          if (Math.abs(event.deltaY) > Math.abs(event.deltaX) && strip.scrollWidth > strip.clientWidth) {
            strip.scrollLeft += event.deltaY;
          }
        }}
      >
        {shown.map((workspace) => {
          const status = statuses.get(workspace.id)!;
          const switching = busy === `ws:${workspace.id}` || progress?.workspaceId === workspace.id;
          return (
            <button
              key={workspace.id}
              type="button"
              data-workspace={workspace.id}
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
        {collapsed && (
          <button type="button" className="ws-chip ws-chip--all" aria-haspopup="dialog" onClick={openPicker}>
            <Search aria-hidden="true" />
            {t('workspaces.all', { n: state.workspaces.length })}
          </button>
        )}
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
            // A second Enter or click while the first is saving must not create a twin.
            if (!name.trim() || creating) return;
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
              data-autofocus
              maxLength={80}
              placeholder={t('workspaces.namePlaceholder')}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <div className="dialog__actions">
            <button type="button" className="btn" onClick={() => setNaming(false)}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn--primary" disabled={!name.trim() || creating}>
              {creating && <Spinner />} {t('common.save')}
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
