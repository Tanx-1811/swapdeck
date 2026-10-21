import { Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { findPreset, isBlockedDomain } from '../core/presets';
import { importantTargets } from '../core/workspaces';
import type { Account, AppDef, Workspace } from '../core/types';
import { customAppFromUrl, presetToInput } from '../shared/apps';
import { send, type MemberResult, type Probe } from '../shared/protocol';
import { requestAccess } from '../ui/access';
import { useConfirm, useToast } from '../ui/controls';
import { VaultNudge } from '../ui/VaultNudge';
import { errorText, useAction, type Snapshot } from '../ui/hooks';
import { useI18n } from '../ui/i18n';
import { AppList } from './AppList';
import { AppPanel } from './AppPanel';
import { START_APP, SwitcherContext, TEST_TAB, type Mode, type SwitchOptions, type Switcher as Api } from './context';
import { Footer, Header, ThisSite, UnlockForm } from './parts';
import { SearchResults } from './SearchResults';
import { WorkspaceBar } from './WorkspaceBar';

/** The tab the popup or side panel acts on: the active tab of its window. */
async function currentTab(): Promise<chrome.tabs.Tab | null> {
  if (TEST_TAB !== null) return TEST_TAB >= 0 ? await chrome.tabs.get(TEST_TAB).catch(() => null) : null;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

async function loadProbe(): Promise<Probe> {
  const tab = await currentTab();
  const result = await send('probe', tab?.id === undefined ? { tabId: -1 } : { tabId: tab.id });
  if (result.ok) return result.data;
  return {
    tabId: tab?.id ?? null,
    url: null,
    appId: null,
    presetId: null,
    access: false,
    identity: null,
    activeId: null,
    matchId: null,
    status: 'unknown',
  };
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const list = matchMedia(query);
    const onChange = () => setMatches(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

type View = { kind: 'current' } | { kind: 'app'; appId: string } | { kind: 'apps' };

type Retry =
  | { kind: 'account'; app: AppDef; account: Account; options: SwitchOptions }
  | { kind: 'workspace'; workspace: Workspace; open: boolean };

export function Switcher({ data, mode }: { data: Snapshot | null; mode: Mode }) {
  const { t } = useI18n();
  const notify = useToast();
  const confirm = useConfirm();
  const [probe, setProbe] = useState<Probe | null>(null);
  const [view, setView] = useState<View>(START_APP ? { kind: 'app', appId: START_APP } : { kind: 'current' });
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [needsUnlock, setNeedsUnlock] = useState(false);
  /** What to do once the vault is unlocked. */
  const retry = useRef<Retry | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const onError = useCallback((message: string) => notify(message, 'error'), [notify]);
  const { run, pending } = useAction(onError, t);
  const panelWide = useMediaQuery('(min-width: 640px)');

  // Re-check the tab whenever apps, accounts, the active accounts, the lock or site access change,
  // and (side panel) whenever another tab becomes current.
  const [refreshCount, refresh] = useReducer((count: number) => count + 1, 0);
  const stateKey = data
    ? JSON.stringify([
        data.state.apps.map((app) => app.id),
        data.state.accounts.length,
        data.state.active,
        data.unlocked,
      ])
    : '';
  useEffect(() => {
    if (!stateKey) return;
    let alive = true;
    void loadProbe().then((value) => {
      if (alive) setProbe(value);
    });
    return () => {
      alive = false;
    };
  }, [stateKey, refreshCount]);

  useEffect(() => {
    chrome.permissions.onAdded.addListener(refresh);
    if (mode !== 'panel') return () => chrome.permissions.onAdded.removeListener(refresh);
    const onActivated = () => {
      setView({ kind: 'current' });
      refresh();
    };
    const onUpdated = (_id: number, info: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) => {
      if (tab.active && (info.url || info.status === 'complete')) refresh();
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.permissions.onAdded.removeListener(refresh);
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, [mode]);

  const state = data?.state;
  const apps = useMemo(() => state?.apps ?? [], [state]);
  const locked = Boolean(state?.vault && !data?.unlocked);
  const wide =
    mode === 'panel'
      ? panelWide
      : state?.settings.popupLayout === 'wide' || (state?.settings.popupLayout !== 'compact' && apps.length >= 3);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('layout-wide', wide);
    root.classList.toggle('mode-panel', mode === 'panel');
  }, [wide, mode]);

  useEffect(() => {
    if (data && probe) document.documentElement.dataset.ready = 'true';
  }, [data, probe]);

  // "/" focuses the search.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.key !== '/' || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if (document.querySelector('dialog[open]')) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const close = useCallback(() => {
    if (mode === 'popup' && TEST_TAB === null) window.close();
  }, [mode]);

  const openManager = useCallback(
    (path = '') => {
      void chrome.tabs.create({ url: chrome.runtime.getURL(`options/options.html${path}`) });
      close();
    },
    [close],
  );

  const onCurrentTab = useCallback((app: AppDef) => probe?.appId === app.id && probe.tabId !== null, [probe]);

  const switchAccount = useCallback(
    async (app: AppDef, account: Account, options: SwitchOptions & { justUnlocked?: boolean } = {}) => {
      if (!state || busy) return;
      if (locked && !options.justUnlocked) {
        retry.current = { kind: 'account', app, account, options };
        setNeedsUnlock(true);
        return;
      }
      const alreadyActive = state.active[app.id] === account.id;
      const ask =
        account.important && !alreadyActive
          ? {
              title: t('account.confirmImportantTitle'),
              body: t('account.confirmImportantBody', { label: account.label, app: app.name }),
              confirmLabel: t('apps.switchHere'),
              danger: true,
            }
          : state.settings.confirmSwitch
            ? {
                title: t('account.switch', { label: account.label }),
                body: t('popup.confirmSwitch', { app: app.name, label: account.label }),
                confirmLabel: t('apps.switchHere'),
              }
            : null;
      if (ask && !(await confirm(ask))) return;
      const here = onCurrentTab(app);
      setBusy(`acc:${account.id}`);
      const result = await send('switch', {
        appId: app.id,
        accountId: account.id,
        ...(here ? { tabId: probe!.tabId! } : options.open ? { focus: true } : { background: true }),
        ...(options.url ? { url: options.url } : {}),
      });
      setBusy(null);
      if (!result.ok) {
        if (result.error === 'LOCKED') {
          retry.current = { kind: 'account', app, account, options };
          setNeedsUnlock(true);
        }
        notify(errorText(t, result), 'error');
        return;
      }
      if (result.data.saved?.created) {
        const saved = state.accounts.find((item) => item.id === result.data.saved?.accountId);
        notify(t('popup.previousSaved', { label: saved?.label ?? '' }), 'info');
      } else if (here || options.open) {
        notify(t('popup.switched', { label: account.label }));
      } else {
        notify(t('popup.switchedApp', { app: app.name, label: account.label }));
      }
      if (here || options.open) close();
    },
    [state, busy, locked, confirm, t, onCurrentTab, probe, notify, close],
  );

  const freshLogin = useCallback(
    async (app: AppDef) => {
      setBusy(`fresh:${app.id}`);
      const result = await send('fresh', {
        appId: app.id,
        ...(onCurrentTab(app) ? { tabId: probe!.tabId! } : { focus: true }),
      });
      setBusy(null);
      if (!result.ok) notify(errorText(t, result), 'error');
      else close();
    },
    [onCurrentTab, probe, notify, t, close],
  );

  const saveSession = useCallback(
    async (app: AppDef, target?: 'new' | string) => {
      const saved = await run(
        'save',
        {
          appId: app.id,
          ...(onCurrentTab(app) ? { tabId: probe!.tabId! } : {}),
          ...(target ? { target } : {}),
        },
        `save:${target ?? ''}`,
      );
      if (!saved) return;
      const latest = await chrome.storage.local.get('sd:accounts');
      const list = (latest['sd:accounts'] as Account[] | undefined) ?? [];
      const label = list.find((item) => item.id === saved.accountId)?.label ?? '';
      notify(saved.created ? t('popup.savedNew', { label }) : t('popup.savedExisting', { label }));
      refresh();
    },
    [run, onCurrentTab, probe, notify, t],
  );

  const describe = useCallback(
    (results: MemberResult[]) => {
      const problems = results.filter((result) => result.status !== 'switched' && result.status !== 'already');
      return problems
        .map((result) => {
          const name = state?.apps.find((app) => app.id === result.appId)?.name ?? result.appId;
          const reason =
            result.status === 'no-access'
              ? t('workspaces.reasonAccess')
              : result.status === 'no-session'
                ? t('workspaces.reasonSession')
                : errorText(t, { error: result.error ?? 'UNKNOWN' });
          return `${name}: ${reason}`;
        })
        .join(' · ');
    },
    [state, t],
  );

  const switchWorkspace = useCallback(
    async (workspace: Workspace, open = false, justUnlocked = false) => {
      if (!state || busy) return;
      if (locked && !justUnlocked) {
        retry.current = { kind: 'workspace', workspace, open };
        setNeedsUnlock(true);
        return;
      }
      const important = importantTargets(workspace, state.apps, state.accounts, state.active);
      if (
        (important.length > 0 || state.settings.confirmSwitch) &&
        !(await confirm({
          title: t('workspaces.confirmTitle', { name: workspace.name }),
          body: important.length
            ? t('workspaces.confirmImportantBody', { list: important.join(', ') })
            : t('workspaces.confirmBody'),
          confirmLabel: t('apps.switchHere'),
          danger: important.length > 0,
        }))
      ) {
        return;
      }
      setBusy(`ws:${workspace.id}`);
      const result = await send(open ? 'workspace.open' : 'workspace.switch', {
        id: workspace.id,
        ...(probe?.tabId !== null && probe?.tabId !== undefined ? { tabId: probe.tabId } : {}),
      });
      setBusy(null);
      if (!result.ok) {
        if (result.error === 'LOCKED') {
          retry.current = { kind: 'workspace', workspace, open };
          setNeedsUnlock(true);
        }
        notify(errorText(t, result), 'error');
        return;
      }
      const { switched, failed, results } = result.data;
      notify(
        switched === 0 && failed === 0
          ? t('workspaces.alreadyInUse', { name: workspace.name })
          : t('workspaces.switched', { name: workspace.name, n: switched }) +
              (failed ? ` ${t('workspaces.someFailed', { details: describe(results) })}` : ''),
        failed ? 'info' : 'success',
      );
      refresh();
    },
    [state, busy, locked, confirm, t, probe, notify, describe],
  );

  const addPreset = useCallback(
    async (presetId: string) => {
      const preset = findPreset(presetId);
      if (!preset) return;
      // Ask for access in the click itself; add the app at the same time so nothing is
      // lost if Chrome closes the popup while its permission prompt is open.
      const [granted, added] = await Promise.all([
        requestAccess(preset),
        send('app.add', { app: presetToInput(preset) }),
      ]);
      if (!added.ok) {
        notify(errorText(t, added), 'error');
        return;
      }
      if (!granted) {
        await send('app.remove', { id: added.data.id });
        notify(t('add.denied'), 'error');
        return;
      }
      notify(t('add.addedToast', { app: preset.name }));
      refresh();
    },
    [notify, t],
  );

  const addSite = useCallback(
    async (url: string) => {
      const input = customAppFromUrl(url);
      if (!input) return;
      const blocked = input.domains.find(isBlockedDomain);
      if (blocked) {
        notify(t('error.BLOCKED_DOMAIN', { domain: blocked }), 'error');
        return;
      }
      const [granted, added] = await Promise.all([requestAccess(input), send('app.add', { app: input })]);
      if (!added.ok) {
        notify(errorText(t, added), 'error');
        return;
      }
      if (!granted) {
        await send('app.remove', { id: added.data.id });
        notify(t('add.denied'), 'error');
        return;
      }
      notify(t('add.addedSiteToast', { app: added.data.name }));
      refresh();
    },
    [notify, t],
  );

  if (!data || !state || !probe) {
    return (
      <div className={`popup popup--${mode}`}>
        <div className="popup__body">
          <div className="skeleton" style={{ height: 52 }} />
          <div className="skeleton" style={{ height: 58 }} />
          <div className="skeleton" style={{ height: 58 }} />
          <span className="visually-hidden">{t('popup.loading')}</span>
        </div>
      </div>
    );
  }

  const api: Api = {
    mode,
    data,
    probe,
    refresh,
    run,
    pending,
    busy,
    locked,
    needsUnlock,
    unlocked: () => {
      setNeedsUnlock(false);
      const next = retry.current;
      retry.current = null;
      if (next?.kind === 'account') void switchAccount(next.app, next.account, { ...next.options, justUnlocked: true });
      if (next?.kind === 'workspace') void switchWorkspace(next.workspace, next.open, true);
    },
    switchAccount,
    freshLogin,
    saveSession,
    switchWorkspace,
    addPreset,
    addSite,
    openManager,
    close,
  };

  const currentApp = apps.find((app) => app.id === probe.appId) ?? null;
  const selectedApp =
    view.kind === 'app'
      ? (apps.find((app) => app.id === view.appId) ?? null)
      : view.kind === 'current'
        ? currentApp
        : null;
  const accountsTotal = state.accounts.length;
  const showSearch = wide || apps.length > 2 || accountsTotal > 5 || state.workspaces.length > 0;
  const showWorkspaces = state.workspaces.length > 0 || apps.length > 1;
  const searching = query.trim().length > 0;
  const currentHasAccounts = Boolean(currentApp && state.accounts.some((account) => account.appId === currentApp.id));
  const unlock = locked && (needsUnlock || (currentHasAccounts && selectedApp?.id === currentApp?.id)) && (
    <UnlockForm />
  );
  const nudge = !locked && (
    <VaultNudge
      settings={state.settings}
      vault={state.vault}
      accounts={state.accounts}
      onOpen={() => openManager('#/security')}
    />
  );
  const selectApp = (appId: string) => {
    setQuery('');
    setView({ kind: 'app', appId });
  };

  const search = showSearch && (
    <div className="input-with-icon search-box">
      <Search aria-hidden="true" />
      <input
        ref={searchRef}
        className="input"
        type="search"
        value={query}
        placeholder={t('popup.searchShort')}
        aria-label={t('popup.searchAll')}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && query) {
            event.preventDefault();
            setQuery('');
          }
        }}
      />
    </div>
  );

  const welcome = apps.length === 0 && (
    <div className="welcome">
      <h2>{t('overview.welcome')}</h2>
      <p>{t('overview.lead')}</p>
      <button type="button" className="btn btn--primary btn--lg" onClick={() => void addPreset('supabase')}>
        {t('overview.step1Action')}
      </button>
      <button type="button" className="btn btn--ghost" onClick={() => openManager('#/add')}>
        {t('overview.addApp')}…
      </button>
    </div>
  );

  return (
    <SwitcherContext value={api}>
      <div className={`popup popup--${mode}${wide ? ' popup--wide' : ''}`}>
        <Header />
        {showWorkspaces && <WorkspaceBar />}
        {wide ? (
          <div className="columns">
            <aside className="columns__side">
              {search}
              <AppList apps={apps} selectedId={selectedApp?.id ?? null} onSelect={selectApp} />
              {!currentApp && probe.url && <ThisSite />}
            </aside>
            <main className="columns__main">
              {nudge}
              {unlock}
              {searching ? (
                <SearchResults query={query} onSelectApp={selectApp} />
              ) : selectedApp ? (
                <AppPanel key={selectedApp.id} app={selectedApp} />
              ) : (
                welcome || <p className="muted pick-hint">{t('popup.pickApp')}</p>
              )}
            </main>
          </div>
        ) : (
          <div className="popup__body">
            {search}
            {nudge}
            {unlock}
            {searching ? (
              <SearchResults query={query} onSelectApp={selectApp} />
            ) : selectedApp ? (
              <AppPanel
                key={selectedApp.id}
                app={selectedApp}
                onBack={view.kind === 'app' ? () => setView({ kind: currentApp ? 'current' : 'apps' }) : undefined}
              />
            ) : (
              <>
                {view.kind !== 'apps' && <ThisSite />}
                {apps.length > 0 && (
                  <section className="section" aria-labelledby="your-apps">
                    <h2 className="section__title" id="your-apps">
                      {t('popup.yourApps')}
                    </h2>
                    <AppList apps={apps} selectedId={null} onSelect={selectApp} chevrons />
                  </section>
                )}
                {welcome}
              </>
            )}
          </div>
        )}
        <Footer
          showKeys={Boolean(selectedApp) && state.accounts.filter((a) => a.appId === selectedApp?.id).length > 1}
        />
      </div>
    </SwitcherContext>
  );
}
