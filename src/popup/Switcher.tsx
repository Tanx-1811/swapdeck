import { Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { findPreset, isBlockedDomain } from '../core/presets';
import { parseHttpUrl } from '../core/domains';
import { importantTargets, liveMembers } from '../core/workspaces';
import type { Account, AppDef, Workspace } from '../core/types';
import { customAppFromUrl, presetToInput } from '../shared/apps';
import { send, type Probe } from '../shared/protocol';
import { requestAccess } from '../ui/access';
import { useAskBeforeSwitch } from '../ui/askBeforeSwitch';
import { useToast } from '../ui/controls';
import { Reminders } from '../ui/Reminders';
import { errorText, useAction, type Snapshot } from '../ui/hooks';
import { useI18n } from '../ui/i18n';
import { workspaceOutcomeMessage } from '../ui/workspaceOutcome';
import { AppList } from './AppList';
import { AppPanel } from './AppPanel';
import { START_APP, SwitcherContext, TEST_TAB, type Mode, type SwitchOptions, type Switcher as Api } from './context';
import { Footer, Header, ThisSite, UnlockForm } from './parts';
import { SearchResults } from './SearchResults';
import { WorkspaceBar } from './WorkspaceBar';
import { WorkspacePicker } from './WorkspacePicker';

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

/** The wide layout's width. */
const WIDE_WIDTH = 720;

/**
 * True when the window can't show the wide layout: Chrome caps popups at 800 × 600
 * screen pixels, so with the page zoomed past about 110 % the 720 px layout would be
 * cut off. The popup sizes itself to its content, so it is judged once it has stopped
 * resizing, and stays compact from then on. Tests open the popup as a tab and resize
 * it freely: there it simply follows the width.
 */
function usePopupTooNarrow(mode: Mode, wantsWide: boolean): boolean {
  const [narrow, setNarrow] = useState(false);
  const follow = TEST_TAB !== null;
  useEffect(() => {
    if (mode !== 'popup' || (!follow && !wantsWide)) return;
    let timer = 0;
    const tooNarrow = () => window.innerWidth > 0 && window.innerWidth < WIDE_WIDTH - 8;
    const check = () => {
      if (follow) setNarrow(tooNarrow());
      // Only once the page has asked for the wide layout and Chrome has sized the popup to it.
      else if (document.documentElement.classList.contains('layout-wide') && tooNarrow()) setNarrow(true);
    };
    const onResize = () => {
      if (follow) return check();
      clearTimeout(timer);
      timer = window.setTimeout(check, 300);
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', onResize);
    };
  }, [mode, follow, wantsWide]);
  return narrow;
}

type View = { kind: 'current' } | { kind: 'app'; appId: string } | { kind: 'apps' };

type Retry =
  | { kind: 'account'; app: AppDef; account: Account; options: SwitchOptions }
  | { kind: 'lane'; app: AppDef; account: Account }
  | { kind: 'workspace'; workspace: Workspace; open: boolean };

export function Switcher({ data, mode }: { data: Snapshot | null; mode: Mode }) {
  const { t } = useI18n();
  const notify = useToast();
  const askBeforeSwitch = useAskBeforeSwitch();
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
        data.lanes.map((lane) => [lane.token, lane.accountId, lane.tabIds.length, lane.status]),
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
  const wantsWide =
    state?.settings.popupLayout === 'wide' || (state?.settings.popupLayout !== 'compact' && apps.length >= 3);
  const narrow = usePopupTooNarrow(mode, wantsWide);
  const wide = mode === 'panel' ? panelWide : wantsWide && !narrow;
  const [picking, setPicking] = useState(false);

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

  // A separate tab has its own sign-in: switches act on the browser's other tabs, never on it.
  const onCurrentTab = useCallback(
    (app: AppDef) => probe?.appId === app.id && probe.tabId !== null && !probe.lane,
    [probe],
  );

  const switchAccount = useCallback(
    async (app: AppDef, account: Account, options: SwitchOptions & { justUnlocked?: boolean } = {}) => {
      if (!state || busy) return;
      if (locked && !options.justUnlocked) {
        retry.current = { kind: 'account', app, account, options };
        setNeedsUnlock(true);
        return;
      }
      const alreadyActive = state.active[app.id] === account.id;
      const go = await askBeforeSwitch({
        kind: 'account',
        label: account.label,
        app: app.name,
        important: account.important && !alreadyActive ? [`${app.name}: ${account.label}`] : [],
        confirmAll: state.settings.confirmSwitch,
        appIds: [app.id],
      });
      if (!go) return;
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
      } else if (probe?.lane && probe.appId === app.id) {
        // Asked from a separate tab of this app: it stays as it is, the other tabs changed.
        notify(t('lane.switchedOthers', { app: app.name, label: account.label }));
      } else {
        notify(t('popup.switchedApp', { app: app.name, label: account.label }));
      }
      if (here || options.open) close();
    },
    [state, busy, locked, askBeforeSwitch, t, onCurrentTab, probe, notify, close],
  );

  const freshLogin = useCallback(
    async (app: AppDef) => {
      const go = await askBeforeSwitch({
        kind: 'fresh',
        label: app.name,
        app: app.name,
        important: [],
        confirmAll: false,
        appIds: [app.id],
      });
      if (!go) return;
      setBusy(`fresh:${app.id}`);
      const result = await send('fresh', {
        appId: app.id,
        ...(onCurrentTab(app) ? { tabId: probe!.tabId! } : { focus: true }),
      });
      setBusy(null);
      if (!result.ok) notify(errorText(t, result), 'error');
      else close();
    },
    [askBeforeSwitch, onCurrentTab, probe, notify, t, close],
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

  const openLane = useCallback(
    async (app: AppDef, account: Account | null, justUnlocked = false) => {
      if (!state || busy) return;
      if (account && locked && !justUnlocked) {
        retry.current = { kind: 'lane', app, account };
        setNeedsUnlock(true);
        return;
      }
      if (account?.important) {
        // The same care as a switch to it; nothing of the browser's own tabs reloads.
        const go = await askBeforeSwitch({
          kind: 'account',
          label: account.label,
          app: app.name,
          important: [`${app.name}: ${account.label}`],
          confirmAll: false,
          appIds: [],
        });
        if (!go) return;
      }
      setBusy(account ? `lane:${account.id}` : `lane:${app.id}`);
      const result = await send('lane.open', {
        appId: app.id,
        accountId: account?.id ?? null,
        ...(probe?.tabId !== null && probe?.tabId !== undefined ? { tabId: probe.tabId } : {}),
      });
      setBusy(null);
      if (!result.ok) {
        if (result.error === 'LOCKED' && account) {
          retry.current = { kind: 'lane', app, account };
          setNeedsUnlock(true);
        }
        notify(errorText(t, result), 'error');
        return;
      }
      close();
    },
    [state, busy, locked, askBeforeSwitch, probe, notify, t, close],
  );

  const switchWorkspace = useCallback(
    async (workspace: Workspace, open = false, justUnlocked = false) => {
      if (!state || busy) return;
      if (locked && !justUnlocked) {
        retry.current = { kind: 'workspace', workspace, open };
        setNeedsUnlock(true);
        return;
      }
      const go = await askBeforeSwitch({
        kind: 'workspace',
        label: workspace.name,
        important: importantTargets(workspace, state.apps, state.accounts, state.active),
        confirmAll: state.settings.confirmSwitch,
        appIds: liveMembers(workspace, state.apps, state.accounts)
          .filter(([appId, accountId]) => state.active[appId] !== accountId)
          .map(([appId]) => appId),
      });
      if (!go) return;
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
      const message = workspaceOutcomeMessage(t, workspace.name, result.data, state.apps);
      notify(message.text, message.tone);
      refresh();
    },
    [state, busy, locked, askBeforeSwitch, t, probe, notify],
  );

  const addPreset = useCallback(
    async (presetId: string) => {
      const preset = findPreset(presetId);
      if (!preset) return;
      // Ask for access in the click itself; add the app at the same time so nothing is
      // lost if Chrome closes the popup while its permission prompt is open.
      const before = Date.now();
      const existed = apps.some((app) => app.presetId === preset.id);
      const [granted, added] = await Promise.all([
        requestAccess(preset),
        send('app.add', { app: presetToInput(preset) }),
      ]);
      if (!added.ok) {
        notify(errorText(t, added), 'error');
        return;
      }
      if (!granted) {
        // Undo only what this click created: "app.add" hands back an app of this preset that was
        // already there (with its accounts and sign-ins), which must never be removed here.
        if (!existed && added.data.createdAt >= before) await send('app.remove', { id: added.data.id });
        notify(t('add.denied'), 'error');
        return;
      }
      notify(t('add.addedToast', { app: preset.name }));
      refresh();
    },
    [apps, notify, t],
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
      const before = Date.now();
      const [granted, added] = await Promise.all([requestAccess(input), send('app.add', { app: input })]);
      if (!added.ok) {
        notify(errorText(t, added), 'error');
        return;
      }
      if (!granted) {
        if (added.data.createdAt >= before) await send('app.remove', { id: added.data.id });
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
      if (next?.kind === 'lane') void openLane(next.app, next.account, true);
    },
    switchAccount,
    freshLogin,
    saveSession,
    openLane,
    switchWorkspace,
    addPreset,
    addSite,
    openManager,
    openPicker: () => setPicking(true),
    close,
  };

  const currentApp = apps.find((app) => app.id === probe.appId) ?? null;
  // The wide layout never leaves its main column empty: away from any app, it shows the one used last.
  const lastUsedApp = (): AppDef | null => {
    let best: { app: AppDef; at: number } | null = null;
    for (const account of state.accounts) {
      const app = apps.find((item) => item.id === account.appId);
      if (app && account.lastUsedAt && (!best || account.lastUsedAt > best.at)) best = { app, at: account.lastUsedAt };
    }
    return best?.app ?? apps[0] ?? null;
  };
  const selectedApp =
    view.kind === 'app'
      ? (apps.find((app) => app.id === view.appId) ?? null)
      : view.kind === 'current'
        ? (currentApp ?? (wide ? lastUsedApp() : null))
        : null;
  const accountsTotal = state.accounts.length;
  const showSearch = wide || apps.length > 2 || accountsTotal > 5 || state.workspaces.length > 0;
  const showWorkspaces = state.workspaces.length > 0 || apps.length > 1;
  const searching = query.trim().length > 0;
  const selectedHasAccounts = Boolean(
    selectedApp && state.accounts.some((account) => account.appId === selectedApp.id && account.capturedAt),
  );
  // Locked with saved sign-ins in view: offer the passphrase up front instead of after a failed switch.
  const unlock = locked && (needsUnlock || selectedHasAccounts) && <UnlockForm />;
  const nudge = !locked && (
    <Reminders
      settings={state.settings}
      vault={state.vault}
      accounts={state.accounts}
      onOpenSecurity={() => openManager('#/security')}
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

  // When the tab's own site can be added (the "This page" card), that is the one primary action.
  const canAddThisSite = !currentApp && Boolean(parseHttpUrl(probe.url));
  const welcome = apps.length === 0 && (
    <div className="welcome">
      <h2>{t('overview.welcome')}</h2>
      <p>{t('overview.lead')}</p>
      {!canAddThisSite && (
        <button type="button" className="btn btn--primary btn--lg" onClick={() => void addPreset('supabase')}>
          {t('overview.step1Action')}
        </button>
      )}
      <button type="button" className="btn btn--ghost" onClick={() => openManager('#/add')}>
        {t(canAddThisSite ? 'popup.browseApps' : 'overview.addApp')}…
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
        {state.workspaces.length > 0 && <WorkspacePicker open={picking} onClose={() => setPicking(false)} />}
      </div>
    </SwitcherContext>
  );
}
