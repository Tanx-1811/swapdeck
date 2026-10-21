import { beforeEach, describe, expect, it } from 'vitest';
import {
  addApp,
  exportBackup,
  importBackup,
  removeAccount,
  saveWorkspace,
  updateAccount,
  updateSettings,
  wipeData,
} from '../../src/background/admin';
import { readStoredSnapshot, storeSnapshot, update } from '../../src/background/state';
import { clearSyncData, syncNow } from '../../src/background/sync';
import { findPreset } from '../../src/core/presets';
import {
  appFromSync,
  appSyncValue,
  applyPull,
  mergeAccount,
  planPull,
  planPush,
  stableJson,
  syncEntries,
  syncHash,
  syncKey,
  TOMBSTONE_TTL_MS,
  type SyncItem,
  type SyncMemo,
} from '../../src/core/sync';
import type { Account, AppDef, Snapshot, Workspace } from '../../src/core/types';
import { presetToInput } from '../../src/shared/apps';
import type { AppInput } from '../../src/shared/protocol';
import { readState } from '../../src/shared/store';

const supabase = () => presetToInput(findPreset('supabase')!);

const custom = (overrides: Partial<AppInput> = {}): AppInput => ({
  name: 'Acme',
  color: '#c8402b',
  domains: ['acme.test'],
  origin: 'https://acme.test',
  homeUrl: 'https://acme.test/',
  stagingPath: '/robots.txt',
  storage: { cookies: true, localStorage: true, sessionStorage: false, indexedDB: false },
  detector: { kind: 'auto' },
  ...overrides,
});

const app = (overrides: Partial<AppDef> = {}): AppDef => ({
  ...custom(),
  id: 'app_acme',
  order: 0,
  createdAt: 1,
  ...overrides,
});

const account = (overrides: Partial<Account> = {}): Account => ({
  id: 'acc_work',
  appId: 'app_acme',
  label: 'Work',
  color: '#c8402b',
  pins: [],
  recents: [],
  order: 0,
  createdAt: 1,
  switchCount: 0,
  ...overrides,
});

const workspace = (overrides: Partial<Workspace> = {}): Workspace => ({
  id: 'ws_acme',
  name: 'Acme',
  color: '#c8402b',
  members: { app_acme: 'acc_work' },
  links: [],
  order: 0,
  createdAt: 1,
  switchCount: 0,
  ...overrides,
});

const snapshot = (token: string): Snapshot => ({
  v: 1,
  capturedAt: Date.now(),
  origin: 'https://acme.test',
  cookies: [],
  storage: { localStorage: { token } },
});

const live = (v: unknown, t: number, by: string): SyncItem => ({ v, t, by });

describe('what travels', () => {
  it('sends the list but never sign-ins or what belongs to one computer', () => {
    const entries = syncEntries({
      apps: [app()],
      accounts: [
        account({
          email: 'work@acme.test',
          capturedAt: 5,
          lastUsedAt: 6,
          lastUrl: 'https://acme.test/projects/1',
          avatarUrl: 'https://acme.test/me.png',
          stats: { cookies: 3, storageKeys: 2, databases: 0, bytes: 900 },
          recents: [{ key: '1', title: 'Project', url: 'https://acme.test/projects/1', at: 6 }],
          switchCount: 9,
          pins: [{ id: 'pin', title: 'Billing', url: 'https://acme.test/billing' }],
        }),
      ],
      workspaces: [workspace({ switchCount: 4, lastUsedAt: 7 })],
    });
    expect(Object.keys(entries).sort()).toEqual(['sd1:a:app_acme', 'sd1:c:acc_work', 'sd1:w:ws_acme']);
    expect(entries['sd1:c:acc_work']).toEqual({
      id: 'acc_work',
      appId: 'app_acme',
      label: 'Work',
      color: '#c8402b',
      email: 'work@acme.test',
      pins: [{ id: 'pin', title: 'Billing', url: 'https://acme.test/billing' }],
      order: 0,
      createdAt: 1,
    });
    expect(entries['sd1:w:ws_acme']).not.toHaveProperty('switchCount');
    expect(entries['sd1:w:ws_acme']).not.toHaveProperty('lastUsedAt');
  });

  it('sends a preset app nobody changed as its preset id, and rebuilds it from the preset', () => {
    const preset = { ...supabase(), id: 'app_supa', order: 2, createdAt: 3 } as AppDef;
    const value = appSyncValue(preset);
    expect(value).toEqual({
      id: 'app_supa',
      presetId: 'supabase',
      name: preset.name,
      color: preset.color,
      order: 2,
      createdAt: 3,
      preset: true,
    });
    expect(appFromSync(value, 'app_here')).toEqual({ ...preset, id: 'app_here' });
    // Changed by the user: the whole definition travels.
    const changed = { ...preset, homeUrl: 'https://supabase.com/dashboard/org/acme' };
    expect(appSyncValue(changed)).toMatchObject({ homeUrl: 'https://supabase.com/dashboard/org/acme' });
    expect(appSyncValue(changed)).not.toHaveProperty('preset');
    // A preset this version doesn't know can't be made here.
    expect(appFromSync({ ...value, presetId: 'not-a-preset' }, 'app_x')).toBeNull();
  });

  it('fingerprints values regardless of key order', () => {
    expect(stableJson({ b: 1, a: [{ d: 2, c: undefined }] })).toBe('{"a":[{"d":2}],"b":1}');
    expect(syncHash({ a: 1, b: 2 })).toBe(syncHash({ b: 2, a: 1 }));
    expect(syncHash({ a: 1 })).not.toBe(syncHash({ a: 2 }));
  });
});

describe('sending', () => {
  const entries = syncEntries({ apps: [app()], accounts: [account()], workspaces: [] });
  const appKey = syncKey('app', 'app_acme');
  const accountKey = syncKey('account', 'acc_work');

  it('sends what changed, and nothing when nothing did', () => {
    const first = planPush(entries, {}, {}, new Set(), 100, 'me');
    expect(Object.keys(first.set).sort()).toEqual([appKey, accountKey]);
    expect(first.set[accountKey]).toEqual({ v: entries[accountKey], t: 100, by: 'me' });
    const second = planPush(entries, first.written, first.set, new Set(), 200, 'me');
    expect(second.set).toEqual({});
    expect(second.gone).toEqual({});
  });

  it('leaves alone what another computer changed meanwhile (the next pull takes it first)', () => {
    const first = planPush(entries, {}, {}, new Set(), 100, 'me');
    const remote = {
      ...first.set,
      [accountKey]: live({ ...(entries[accountKey] as object), label: 'Main' }, 150, 'other'),
    };
    const changedHere = syncEntries({ apps: [app()], accounts: [account({ label: 'Mine' })], workspaces: [] });
    expect(planPush(changedHere, first.written, remote, new Set(), 200, 'me').set).toEqual({});
  });

  it('sends again what disappeared from Chrome Sync', () => {
    const first = planPush(entries, {}, {}, new Set(), 100, 'me');
    expect(Object.keys(planPush(entries, first.written, {}, new Set(), 200, 'me').set)).toHaveLength(2);
  });

  it('writes tombstones only for what was removed on purpose', () => {
    const first = planPush(entries, {}, {}, new Set(), 100, 'me');
    const withoutAccount = syncEntries({ apps: [app()], accounts: [], workspaces: [] });
    const removed = planPush(withoutAccount, first.written, first.set, new Set([accountKey]), 200, 'me');
    expect(removed.gone).toEqual({ [accountKey]: { gone: true, t: 200, by: 'me' } });
    expect(removed.forget).toEqual([accountKey]);
    // Lost (not removed by the user): forgotten, nothing removed elsewhere.
    const lost = planPush(withoutAccount, first.written, first.set, new Set(), 200, 'me');
    expect(lost.gone).toEqual({});
    expect(lost.forget).toEqual([accountKey]);
  });

  it('keeps too-big things here and drops old tombstones', () => {
    const big = syncEntries({
      apps: [],
      accounts: [
        account({
          note: 'x'.repeat(1000),
          pins: Array.from({ length: 30 }, (_, i) => ({
            id: `p${i}`,
            title: 'x'.repeat(200),
            url: `https://acme.test/${i}`,
          })),
        }),
      ],
      workspaces: [],
    });
    const plan = planPush(
      big,
      {},
      { 'sd1:c:old': { gone: true, t: 0, by: 'other' } },
      new Set(),
      TOMBSTONE_TTL_MS + 1,
      'me',
    );
    expect(plan.tooBig).toEqual([accountKey]);
    expect(plan.set).toEqual({});
    expect(plan.drop).toEqual(['sd1:c:old']);
  });
});

describe('receiving', () => {
  it('takes writes it has not seen, apps first, and forgets what disappeared', () => {
    const memo: SyncMemo = {
      'sd1:c:acc_seen': { hash: 'h', t: 5, by: 'other' },
      'sd1:c:acc_gone': { hash: 'h', t: 5, by: 'other' },
    };
    const remote = {
      'sd1:w:ws_1': live({}, 3, 'other'),
      'sd1:c:acc_seen': live({}, 5, 'other'),
      'sd1:c:acc_new': live({}, 9, 'other'),
      'sd1:a:app_1': live({}, 10, 'other'),
      'not-ours': live({}, 1, 'other'),
    };
    const plan = planPull(remote, memo);
    expect(plan.upserts.map((item) => item.key)).toEqual(['sd1:a:app_1', 'sd1:c:acc_new', 'sd1:w:ws_1']);
    expect(plan.deletes).toEqual([]);
    expect(plan.forget).toEqual(['sd1:c:acc_gone']);
  });

  it('removes on a tombstone only what it had synced, through its alias', () => {
    const memo: SyncMemo = { 'sd1:c:acc_there': { hash: 'h', t: 5, by: 'other', local: 'acc_here' } };
    const plan = planPull(
      { 'sd1:c:acc_there': { gone: true, t: 6, by: 'other' }, 'sd1:c:acc_never': { gone: true, t: 6, by: 'other' } },
      memo,
    );
    expect(plan.deletes).toEqual([{ kind: 'account', id: 'acc_here', key: 'sd1:c:acc_there' }]);
  });

  it('applies a new account without a sign-in, and keeps sign-ins and identity of one saved here', () => {
    const draft = { apps: [app()], accounts: [] as Account[], workspaces: [] as Workspace[] };
    const value = syncEntries({ apps: [], accounts: [account({ email: 'work@acme.test' })], workspaces: [] })[
      'sd1:c:acc_work'
    ];
    const plan = planPull({ 'sd1:c:acc_work': live(value, 5, 'other') }, {});
    const outcome = applyPull(draft, plan.upserts, {});
    expect(outcome.added).toBe(1);
    expect(draft.accounts[0]).toMatchObject({ id: 'acc_work', email: 'work@acme.test', switchCount: 0 });
    expect(draft.accounts[0]).not.toHaveProperty('capturedAt');
    expect(outcome.applied['sd1:c:acc_work']).toMatchObject({ t: 5, by: 'other' });

    const here = account({ email: 'me@acme.test', capturedAt: 9, lastUrl: 'https://acme.test/x', switchCount: 3 });
    const merged = mergeAccount(here, { ...account({ label: 'Renamed', email: 'someone@acme.test' }) });
    expect(merged).toMatchObject({ label: 'Renamed', email: 'me@acme.test', capturedAt: 9, switchCount: 3 });
    expect(merged.lastUrl).toBe('https://acme.test/x');
  });

  it('matches what was set up here separately instead of copying it', () => {
    const draft = {
      apps: [app({ id: 'app_here' })],
      accounts: [
        account({ id: 'acc_here', appId: 'app_here', label: 'Công việc', email: 'ME@acme.test', capturedAt: 3 }),
      ],
      workspaces: [workspace({ id: 'ws_here', name: 'acme ', members: { app_here: 'acc_here' } })],
    };
    const entries = syncEntries({
      apps: [app({ id: 'app_there' })],
      accounts: [account({ id: 'acc_there', appId: 'app_there', email: 'me@acme.test' })],
      workspaces: [workspace({ id: 'ws_there', members: { app_there: 'acc_there' }, note: 'Client' })],
    });
    const remote = Object.fromEntries(Object.entries(entries).map(([key, value]) => [key, live(value, 5, 'other')]));
    const outcome = applyPull(draft, planPull(remote, {}).upserts, {});
    expect(draft.apps.map((item) => item.id)).toEqual(['app_here']);
    expect(draft.accounts.map((item) => [item.id, item.label, item.email])).toEqual([
      ['acc_here', 'Work', 'ME@acme.test'],
    ]);
    expect(draft.workspaces).toHaveLength(1);
    expect(draft.workspaces[0]).toMatchObject({ id: 'ws_here', note: 'Client', members: { app_here: 'acc_here' } });
    expect(outcome.applied['sd1:c:acc_there']?.local).toBe('acc_here');
    expect(outcome.applied['sd1:w:ws_there']?.local).toBe('ws_here');
  });

  it('never adds an app that shares a site with another one here, nor a blocked site', () => {
    const draft = { apps: [app({ id: 'app_here', domains: ['acme.test'] })], accounts: [], workspaces: [] };
    const remote = {
      'sd1:a:app_sub': live(
        app({ id: 'app_sub', name: 'Sub', domains: ['eu.other.test', 'acme.test'], origin: 'https://eu.other.test' }),
        5,
        'x',
      ),
      'sd1:a:app_google': live(
        app({ id: 'app_google', domains: ['google.com'], origin: 'https://google.com' }),
        5,
        'x',
      ),
    };
    applyPull(draft, planPull(remote, {}).upserts, {});
    // The overlapping one is taken as the same app; the blocked one is never added.
    expect(draft.apps.map((item) => item.id)).toEqual(['app_here']);
  });

  it('waits for an account before adding it, and fills workspace members once they arrive', () => {
    const draft = { apps: [] as AppDef[], accounts: [] as Account[], workspaces: [] as Workspace[] };
    const all = syncEntries({ apps: [app()], accounts: [account()], workspaces: [workspace()] });
    // The account and the workspace arrive before the app.
    const early = {
      'sd1:c:acc_work': live(all['sd1:c:acc_work'], 5, 'other'),
      'sd1:w:ws_acme': live(all['sd1:w:ws_acme'], 5, 'other'),
    };
    const first = applyPull(draft, planPull(early, {}).upserts, {});
    expect(draft.accounts).toEqual([]);
    expect(draft.workspaces[0]?.members).toEqual({});
    expect(first.applied['sd1:w:ws_acme']?.again).toBe(true);
    expect(first.applied).not.toHaveProperty(['sd1:c:acc_work']);

    const memo = first.applied;
    const later = { ...early, 'sd1:a:app_acme': live(all['sd1:a:app_acme'], 6, 'other') };
    const plan = planPull(later, memo);
    expect(plan.upserts.map((item) => [item.key, item.retry])).toEqual([
      ['sd1:a:app_acme', false],
      ['sd1:c:acc_work', false],
      ['sd1:w:ws_acme', true],
    ]);
    const second = applyPull(draft, plan.upserts, memo);
    expect(draft.workspaces[0]?.members).toEqual({ app_acme: 'acc_work' });
    expect(second.applied['sd1:w:ws_acme']?.again).toBeUndefined();
  });

  it('never moves an account to another app, and lets a removal here win', () => {
    const draft = {
      apps: [app(), app({ id: 'app_other', name: 'Other', domains: ['other.test'], origin: 'https://other.test' })],
      accounts: [account({ capturedAt: 1 })],
      workspaces: [] as Workspace[],
    };
    const moved = syncEntries({ apps: [], accounts: [account({ appId: 'app_other' })], workspaces: [] });
    applyPull(draft, planPull({ 'sd1:c:acc_work': live(moved['sd1:c:acc_work'], 5, 'other') }, {}).upserts, {});
    expect(draft.accounts[0]?.appId).toBe('app_acme');

    const memo: SyncMemo = { 'sd1:c:acc_gone': { hash: 'h', t: 1, by: 'other' } };
    const edited = { 'sd1:c:acc_gone': live({ ...account({ id: 'acc_gone' }), label: 'Edited' }, 5, 'other') };
    const outcome = applyPull(draft, planPull(edited, memo).upserts, memo, new Set(['sd1:c:acc_gone']));
    expect(outcome.added).toBe(0);
    expect(draft.accounts.map((item) => item.id)).toEqual(['acc_work']);
  });
});

// --- Two computers sharing one Chrome Sync ------------------------------------

type Area = { store: Map<string, unknown> };
const localStore = () => (chrome.storage.local as unknown as Area).store;
const syncStore = () => (chrome.storage.sync as unknown as Area).store;

const computers = new Map<string, Map<string, unknown>>();
beforeEach(() => computers.clear());

/** Runs `task` on one computer: its own chrome.storage.local, the shared chrome.storage.sync. */
async function on<T>(name: string, task: () => Promise<T>): Promise<T> {
  const store = localStore();
  store.clear();
  for (const [key, value] of computers.get(name) ?? []) store.set(key, value);
  try {
    return await task();
  } finally {
    computers.set(name, new Map(store));
    store.clear();
  }
}

async function addAccount(appId: string, id: string, extra: Partial<Account> = {}) {
  await update((draft) => {
    draft.accounts.push(account({ id, appId, label: id, order: draft.accounts.length, ...extra }));
  });
}

async function syncOn() {
  await updateSettings({ syncList: true });
  await syncNow();
}

describe('two computers', () => {
  it('brings the list to another computer without the sign-ins', async () => {
    const appId = await on('A', async () => {
      const created = await addApp(supabase());
      await addAccount(created.id, 'acc_work', { label: 'Work', email: 'work@acme.test', capturedAt: 5 });
      await storeSnapshot('acc_work', snapshot('secret-token'));
      await saveWorkspace(undefined, {
        name: 'Acme',
        color: '#c8402b',
        members: { [created.id]: 'acc_work' },
        links: [],
      });
      await syncOn();
      return created.id;
    });
    const synced = JSON.stringify([...syncStore()]);
    expect(synced).not.toContain('secret-token');
    expect(synced).not.toContain('capturedAt');
    expect([...syncStore().keys()].every((key) => key.startsWith('sd1:'))).toBe(true);

    await on('B', async () => {
      await syncOn();
      const state = await readState();
      expect(state.apps.map((item) => [item.id, item.presetId])).toEqual([[appId, 'supabase']]);
      expect(state.accounts).toHaveLength(1);
      expect(state.accounts[0]).toMatchObject({ id: 'acc_work', label: 'Work', email: 'work@acme.test' });
      expect(state.accounts[0]).not.toHaveProperty('capturedAt');
      expect(state.workspaces[0]?.members).toEqual({ [appId]: 'acc_work' });
      expect(await readStoredSnapshot('acc_work')).toBeNull();
    });
  });

  it('carries changes both ways and keeps each computer’s sign-ins', async () => {
    await on('A', async () => {
      const created = await addApp(custom());
      await addAccount(created.id, 'acc_work', { capturedAt: 5, email: 'work@acme.test' });
      await storeSnapshot('acc_work', snapshot('a-token'));
      await syncOn();
    });
    await on('B', async () => {
      await syncOn();
      await updateAccount('acc_work', { label: 'Work (main)', note: 'Billing owner' });
      await syncNow();
    });
    await on('A', async () => {
      await syncNow();
      const state = await readState();
      expect(state.accounts[0]).toMatchObject({ label: 'Work (main)', note: 'Billing owner', capturedAt: 5 });
      expect(await readStoredSnapshot('acc_work')).not.toBeNull();
    });
  });

  it('removes what was removed on purpose, and brings back what was only lost', async () => {
    await on('A', async () => {
      const created = await addApp(custom());
      await addAccount(created.id, 'acc_one');
      await addAccount(created.id, 'acc_two');
      await syncOn();
    });
    await on('B', async () => {
      await syncOn();
      await storeSnapshot('acc_one', snapshot('b-token'));
    });
    await on('A', async () => {
      await removeAccount('acc_one');
      await syncNow();
    });
    await on('B', async () => {
      await syncNow();
      expect((await readState()).accounts.map((item) => item.id)).toEqual(['acc_two']);
      expect(await readStoredSnapshot('acc_one')).toBeNull();
      // Lost without being removed (say, damaged storage): taken back from Chrome Sync…
      await chrome.storage.local.remove('sd:accounts');
      await syncNow();
      expect((await readState()).accounts.map((item) => item.id)).toEqual(['acc_two']);
    });
    // …and never removed on the other computer.
    await on('A', async () => {
      await syncNow();
      expect((await readState()).accounts.map((item) => item.id)).toEqual(['acc_two']);
    });
  });

  it('matches what both computers set up separately, then removes it everywhere', async () => {
    await on('A', async () => {
      const created = await addApp(supabase());
      await addAccount(created.id, 'acc_a', { label: 'Work', email: 'me@acme.test', capturedAt: 1 });
      await syncOn();
    });
    await on('B', async () => {
      const created = await addApp(supabase());
      await addAccount(created.id, 'acc_b', { label: 'Công việc', email: 'ME@acme.test', capturedAt: 2 });
      await storeSnapshot('acc_b', snapshot('b-token'));
      await syncOn();
    });
    for (const name of ['A', 'B', 'A']) await on(name, syncNow);
    for (const name of ['A', 'B']) {
      await on(name, async () => {
        const state = await readState();
        expect(state.apps).toHaveLength(1);
        expect(state.accounts.map((item) => item.label)).toEqual(['Work']);
      });
    }
    await on('A', async () => {
      await removeAccount('acc_a');
      await syncNow();
    });
    await on('B', async () => {
      await syncNow();
      expect((await readState()).accounts).toEqual([]);
      expect(await readStoredSnapshot('acc_b')).toBeNull();
    });
  });

  it('clearing Chrome Sync removes nothing, and computers still syncing send their list again', async () => {
    await on('A', async () => {
      const created = await addApp(custom());
      await addAccount(created.id, 'acc_work');
      await syncOn();
    });
    await on('B', syncOn);
    await on('A', async () => {
      await updateSettings({ syncList: false });
      await clearSyncData();
    });
    expect(syncStore().size).toBe(0);
    await on('B', async () => {
      await syncNow();
      expect((await readState()).accounts).toHaveLength(1);
    });
    expect([...syncStore().keys()].sort()).toEqual(expect.arrayContaining([expect.stringMatching(/^sd1:c:acc_work$/)]));
    await on('A', async () => {
      expect((await readState()).accounts).toHaveLength(1);
    });
  });

  it('turns sync off when a backup replaces everything, and a wipe forgets what was synced', async () => {
    await on('A', async () => {
      const created = await addApp(custom());
      await addAccount(created.id, 'acc_work');
      await syncOn();
      const text = await exportBackup(null, false);
      const lastBackupAt = (await readState()).settings.lastBackupAt;
      expect(lastBackupAt).toBeGreaterThan(0);
      expect(await importBackup(text, undefined, 'replace')).toMatchObject({ syncOff: true });
      const settings = (await readState()).settings;
      expect(settings.syncList).toBe(false);
      expect(settings.lastBackupAt).toBe(lastBackupAt);

      await wipeData();
      expect(await chrome.storage.local.get(['sd:syncMemo', 'sd:syncRemoved', 'sd:install'])).toEqual({});
    });
    // Chrome Sync still holds the list for the other computers.
    expect(syncStore().has('sd1:c:acc_work')).toBe(true);
  });
});
