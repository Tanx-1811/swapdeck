import {
  AppWindow,
  ChevronLeft,
  Ellipsis,
  ExternalLink,
  House,
  LogIn,
  Pencil,
  Pin,
  PinOff,
  RefreshCw,
  RotateCcw,
  Save,
  Settings,
  SquareDashed,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { appForUrl, displayUrl } from '../core/domains';
import { identityLabel } from '../core/identity';
import type { Account, AppDef } from '../core/types';
import { AccountEditor } from '../ui/AccountEditor';
import { useAskBeforeLaneClose } from '../ui/askBeforeSwitch';
import { AppIcon } from '../ui/Avatar';
import { Callout, MenuButton, Spinner, useConfirm, useToast, type MenuItem } from '../ui/controls';
import { usePreviousSessions } from '../ui/hooks';
import { useI18n } from '../ui/i18n';
import { useSwitcher } from './context';
import { LaneCard } from './LaneCard';
import { AccessCheck, AccountRow } from './parts';

/**
 * The accounts of one app. For the current tab's app it also shows who is
 * signed in and offers to save the session; for other apps, switching happens
 * in the background (nothing opens unless asked).
 */
export function AppPanel({ app, onBack }: { app: AppDef; onBack?: () => void }) {
  const { t } = useI18n();
  const notify = useToast();
  const confirm = useConfirm();
  const askBeforeLaneClose = useAskBeforeLaneClose();
  const { data, probe, run, pending, busy, switchAccount, freshLogin, saveSession, openLane, openManager, close } =
    useSwitcher();
  const [editing, setEditing] = useState<Account | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { state } = data;
  const accounts = useMemo(() => state.accounts.filter((account) => account.appId === app.id), [state, app.id]);
  const activeId = state.active[app.id] ?? null;
  const active = accounts.find((account) => account.id === activeId);
  // The current tab may be a separate tab of this app (its own sign-in): shown on its own.
  const hereLane =
    probe.appId === app.id && probe.lane
      ? (data.lanes.find((lane) => lane.token === probe.lane!.token) ?? probe.lane)
      : null;
  const onCurrentTab = probe.appId === app.id && !hereLane;
  const appLanes = data.lanes.filter((lane) => lane.appId === app.id);
  const laneOf = (accountId: string) => appLanes.find((lane) => lane.accountId === accountId);
  const status = onCurrentTab ? probe.status : null;
  const who = identityLabel(probe.identity);
  const match = accounts.find((account) => account.id === probe.matchId);
  const mismatch = !onCurrentTab && data.live[app.id]?.mismatch;
  const showSave = onCurrentTab && probe.access && (status === 'unsaved' || status === 'unknown' || !accounts.length);
  const accountIds = useMemo(() => accounts.map((account) => account.id), [accounts]);
  const previous = usePreviousSessions(accountIds);

  // With many accounts, the one in use may sit far down the list: bring it into view once. Not in
  // a separate tab, whose card at the top matters more than the account of the other tabs.
  const inLane = hereLane !== null;
  useEffect(() => {
    if (!activeId || inLane) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-account="${CSS.escape(activeId)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
    // Only when the panel opens (or another account comes into use), not on every update.
  }, [activeId, inLane]);

  // Keyboard: 1–9 switch, arrows move between accounts.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;
      if (document.querySelector('dialog[open]') || document.querySelector('.menu')) return;
      if (/^[1-9]$/.test(event.key) && !event.altKey && !event.metaKey && !event.ctrlKey) {
        const account = accounts[Number(event.key) - 1];
        if (account) {
          event.preventDefault();
          void switchAccount(app, account);
        }
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        // Other lists (apps, workspaces) handle their own arrows.
        const focused = document.activeElement;
        if (focused && focused !== document.body && !listRef.current?.contains(focused)) return;
        const rows = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('.account__main') ?? [])];
        if (!rows.length) return;
        event.preventDefault();
        const index = rows.indexOf(document.activeElement as HTMLButtonElement);
        const next = index === -1 ? 0 : (index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
        rows[next]?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [accounts, app, switchAccount]);

  const accountMenu = (account: Account): MenuItem[] => {
    const isActive = account.id === activeId;
    const pageUrl = onCurrentTab && probe.url && appForUrl([app], probe.url) ? probe.url : null;
    const pinned = pageUrl ? account.pins.find((pin) => pin.url === pageUrl) : undefined;
    const items: MenuItem[] = [{ label: t('common.edit'), icon: <Pencil />, onSelect: () => setEditing(account) }];
    if (account.expiredAt) {
      items.unshift({ label: t('account.signInAgain'), icon: <LogIn />, onSelect: () => void freshLogin(app) });
    }
    if (!onCurrentTab && account.capturedAt) {
      items.push({
        label: t('account.switchAndOpen'),
        icon: <ExternalLink />,
        onSelect: () => void switchAccount(app, account, { open: true }),
      });
    }
    const lane = laneOf(account.id);
    if (lane) {
      items.push(
        {
          label: t('lane.show'),
          icon: <AppWindow />,
          onSelect: async () => {
            if (await run('lane.focus', { token: lane.token })) close();
          },
        },
        {
          label: t('lane.close'),
          icon: <X />,
          hint: t('lane.closeHint'),
          onSelect: async () => {
            if (await askBeforeLaneClose(lane)) await run('lane.close', { token: lane.token });
          },
        },
      );
    } else if (!isActive && account.capturedAt) {
      items.push({
        label: t('lane.open'),
        icon: <AppWindow />,
        hint: t('lane.openHint'),
        onSelect: () => void openLane(app, account),
      });
    }
    if (isActive && pageUrl) {
      items.push(
        pinned
          ? {
              label: t('account.unpinPage'),
              icon: <PinOff />,
              onSelect: () => void run('account.unpin', { id: account.id, pinId: pinned.id }),
            }
          : {
              label: t('account.pinPage'),
              icon: <Pin />,
              onSelect: async () => {
                const tab = probe.tabId !== null ? await chrome.tabs.get(probe.tabId).catch(() => null) : null;
                await run('account.pin', { id: account.id, url: pageUrl, title: tab?.title ?? displayUrl(pageUrl) });
              },
            },
        {
          label: t('account.useThisPage'),
          icon: <House />,
          onSelect: () => void run('account.update', { id: account.id, patch: { homeUrl: pageUrl } }),
        },
      );
    }
    if (isActive && onCurrentTab && probe.access && status !== 'mismatch' && status !== 'signed-out') {
      items.push({
        label: t('account.updateSession'),
        icon: <RefreshCw />,
        onSelect: () => void saveSession(app, account.id),
      });
    }
    // "Restore previous" only when there is an earlier session to go back to.
    if (previous.has(account.id)) {
      items.push({
        label: t('account.restorePrevious'),
        icon: <RotateCcw />,
        onSelect: async () => {
          if (await run('restorePrevious', { accountId: account.id })) notify(t('account.restoredPrevious'), 'info');
        },
      });
    }
    items.push(
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
    );
    return items;
  };

  return (
    <div className="app-panel">
      <div className="app-head">
        {onBack && (
          <button
            type="button"
            className="btn btn--ghost btn--icon btn--sm"
            onClick={onBack}
            aria-label={t('popup.allApps')}
            title={t('popup.allApps')}
          >
            <ChevronLeft />
          </button>
        )}
        <AppIcon app={app} />
        <div className="app-head__text">
          <h1 className="app-head__name">{app.name}</h1>
          <p className="app-head__meta truncate">
            {status === 'unknown' && probe.identity?.confidence === 'weak'
              ? t('status.weak', { who })
              : app.domains.join(', ')}
          </p>
        </div>
        {/* In a separate tab the app is open already: "Open" (an ordinary tab) is in the menu, said so. */}
        {!onCurrentTab && !inLane && (
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => {
              void chrome.tabs.create({ url: active?.lastUrl ?? active?.homeUrl ?? app.homeUrl });
              close();
            }}
          >
            <ExternalLink /> {t('common.open')}
          </button>
        )}
        <MenuButton
          label={t('common.more')}
          icon={<Ellipsis />}
          items={[
            {
              label: inLane ? t('lane.openOrdinary', { app: app.name }) : t('popup.openApp', { app: app.name }),
              icon: <ExternalLink />,
              onSelect: () => {
                void chrome.tabs.create({ url: active?.lastUrl ?? app.homeUrl });
                close();
              },
            },
            { label: t('common.manage'), icon: <Settings />, onSelect: () => openManager(`#/apps/${app.id}`) },
          ]}
        />
      </div>

      {hereLane && <LaneCard app={app} lane={hereLane} />}
      {status === 'match' && (
        <p className="status-bar">
          <span className="dot dot--pulse" aria-hidden="true" />
          <span className="truncate">
            {t('status.signedInAs')}
            <strong>{who}</strong>
          </span>
        </p>
      )}
      {onCurrentTab && !probe.access && <AccessCheck app={app} />}
      {!onCurrentTab && <AccessCheck app={app} />}
      {status === 'unsaved' && (
        <Callout
          tone="brand"
          title={t('status.unsaved', { who })}
          actions={
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={() => void saveSession(app, 'new')}
              disabled={pending !== null}
            >
              {pending === 'save:new' ? <Spinner /> : <Save />} {t('popup.saveAsNew')}
            </button>
          }
        >
          {t('status.unsavedHint')}
        </Callout>
      )}
      {status === 'mismatch' && (
        <Callout
          tone="warning"
          title={active ? t('status.mismatch', { who, label: active.label }) : t('status.mismatchUnsaved', { who })}
          actions={
            match && (
              <button type="button" className="btn btn--sm" onClick={() => void saveSession(app, match.id)}>
                {t('status.mismatchFix', { match: match.label })}
              </button>
            )
          }
        />
      )}
      {mismatch && <Callout tone="warning" title={t('status.mismatchElsewhere', { app: app.name })} />}
      {status === 'signed-out' && accounts.length > 0 && (
        <Callout tone="info" title={t('status.signedOut', { app: app.name })}>
          {t('status.signedOutHint')}
        </Callout>
      )}

      {/* A separate tab with nothing saved yet: its card above says what to do (sign in, save). */}
      {accounts.length === 0 ? (
        !inLane && (
          <div className="empty">
            <p className="empty__title">{t('popup.noAccounts', { app: app.name })}</p>
            <p className="empty__text">
              {onCurrentTab ? t('popup.noAccountsHint') : t('popup.noAccountsElsewhere', { app: app.name })}
            </p>
            {!onCurrentTab && (
              <button
                type="button"
                className="btn btn--primary empty__action"
                onClick={() => {
                  void chrome.tabs.create({ url: app.homeUrl });
                  close();
                }}
              >
                <ExternalLink /> {t('popup.openToSignIn', { app: app.name })}
              </button>
            )}
          </div>
        )
      ) : (
        <>
          {/* In a separate tab, the list acts on the browser's other tabs: say so above it. */}
          {inLane && (
            <div className="lane-others">
              <h2 className="section__title" id="lane-others">
                {t('lane.otherTabs', { app: app.name })}
              </h2>
              <p className="lane-others__hint">{t('lane.otherTabsHint')}</p>
            </div>
          )}
          <div
            className="accounts"
            ref={listRef}
            role="list"
            aria-label={inLane ? undefined : t('apps.accountsHeading')}
            aria-labelledby={inLane ? 'lane-others' : undefined}
          >
            {accounts.map((account, index) => (
              <AccountRow
                key={account.id}
                account={account}
                index={index}
                active={account.id === activeId}
                busy={busy === `acc:${account.id}` || busy === `lane:${account.id}`}
                disabled={busy !== null}
                menu={accountMenu(account)}
                onSwitch={() => void switchAccount(app, account)}
                onOpen={(url) => {
                  if (onCurrentTab && probe.tabId !== null && account.id === activeId) {
                    void chrome.tabs.update(probe.tabId, { url });
                    close();
                  } else {
                    void switchAccount(app, account, { url, open: true });
                  }
                }}
              />
            ))}
          </div>
        </>
      )}

      <div className="popup__actions">
        {/* In a separate tab, another account means a scratch tab: nothing else changes. */}
        {inLane && (
          <button
            type="button"
            className="btn btn--dashed"
            onClick={() => void openLane(app, null)}
            disabled={busy !== null}
            title={t('lane.freshScratchHint')}
          >
            {busy === `lane:${app.id}` ? <Spinner /> : <SquareDashed />} {t('lane.freshScratch')}
          </button>
        )}
        {/* With nothing saved and the app not open here, "another account" means nothing yet. */}
        {!inLane && (accounts.length > 0 || onCurrentTab) && (
          <button
            type="button"
            className="btn btn--dashed"
            onClick={() => void freshLogin(app)}
            disabled={busy !== null || (onCurrentTab && !probe.access)}
            title={t('popup.newLoginHint', { app: app.name })}
          >
            {busy === `fresh:${app.id}` ? <Spinner /> : <UserPlus />} {t('popup.newLogin')}
          </button>
        )}
        {showSave && (
          <button type="button" className="btn" onClick={() => void saveSession(app)} disabled={pending !== null}>
            {pending === 'save:' ? <Spinner /> : <Save />} {t('popup.saveSession')}
          </button>
        )}
        {!inLane && (
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => void openLane(app, null)}
            disabled={busy !== null}
            title={t('lane.scratchHint')}
          >
            {busy === `lane:${app.id}` ? <Spinner /> : <SquareDashed />} {t('lane.scratch')}
          </button>
        )}
      </div>
      {editing && (
        <AccountEditor
          account={editing}
          open
          busy={pending === 'account.update'}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            if (await run('account.update', { id: editing.id, patch })) setEditing(null);
          }}
        />
      )}
    </div>
  );
}
