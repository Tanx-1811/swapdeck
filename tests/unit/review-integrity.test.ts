/*
 * Data integrity, persistence and security: regression tests from the 1.7.0 review (R1–R9 are the findings,
 * I1–I5 the improvements). Sync cases use the same two-computer simulation as sync.test.ts.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addApp,
  exportBackup,
  importBackup,
  removeAccount,
  removeApp,
  removeWorkspace,
  reorderAccounts,
  reorderWorkspaces,
  saveWorkspace,
  updateAccount,
  updateSettings,
  vaultChange,
  vaultCreate,
  vaultLock,
  vaultUnlock,
  wipeData,
} from '../../src/background/admin';
import { fromOwnPage } from '../../src/background/router';
import { getPrivateKey, loadSnapshot, readStoredSnapshot, storeSnapshot, update } from '../../src/background/state';
import { syncNow } from '../../src/background/sync';
import { sanitizePayload } from '../../src/core/backup';
import { createVault, unseal } from '../../src/core/crypto';
import { decideSave } from '../../src/core/decide';
import { findPreset } from '../../src/core/presets';
import { parseSettings } from '../../src/core/settings';
import {
  APP_SYNC_FIELDS,
  applyPull,
  mergeFields,
  planPush,
  LEGACY_SYNC_FIELDS,
  SCHEMA_FIELDS,
  settleDeletes,
  SYNC_FIELDS,
  SYNC_SCHEMA,
  TOMBSTONE_TTL_MS,
  writerFields,
  type SyncItem,
} from '../../src/core/sync';
import type { Account, AppDef, Snapshot } from '../../src/core/types';
import {
  sanitizeAccount,
  sanitizeActive,
  sanitizeApp,
  sanitizeStorageDump,
  sanitizeWorkspace,
} from '../../src/core/validate';
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

const snapshot = (token: string): Snapshot => ({
  v: 1,
  capturedAt: Date.now(),
  origin: 'https://acme.test',
  cookies: [],
  storage: { localStorage: { token } },
});

const bigPins = Array.from({ length: 30 }, (_, i) => ({
  id: `pin${i}`,
  title: 'x'.repeat(200),
  url: `https://acme.test/${'p'.repeat(300)}/${i}`,
}));

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

const labels = async () => (await readState()).accounts.map((item) => item.label);

describe('sync: removed and set up again elsewhere (R1)', () => {
  it('R1a: an account removed and added again on A (B asleep) stays on both computers', async () => {
    const appId = await on('A', async () => {
      const created = await addApp(custom());
      await addAccount(created.id, 'acc_old', { label: 'Me', email: 'me@acme.test' });
      await syncOn();
      return created.id;
    });
    await on('B', async () => {
      await syncOn();
      await storeSnapshot('acc_old', snapshot('b-token'));
    });
    // B is asleep. On A the user removes the account, then signs in again (a new account, same person).
    await on('A', async () => {
      await removeAccount('acc_old');
      await syncNow();
      await addAccount(appId, 'acc_new', { label: 'Me again', email: 'me@acme.test', capturedAt: Date.now() });
      await storeSnapshot('acc_new', snapshot('a-new-token'));
      await syncNow();
    });
    // B wakes up and gets the tombstone and the new account in one pull.
    await on('B', async () => {
      await syncNow();
      expect((await readState()).accounts.map((item) => item.id)).toEqual(['acc_new']);
      expect(await readStoredSnapshot('acc_old')).toBeNull();
    });
    await on('A', async () => {
      await syncNow();
      expect((await readState()).accounts.map((item) => item.id)).toEqual(['acc_new']);
      expect(await readStoredSnapshot('acc_new')).not.toBeNull();
    });
  });

  it('R1b: a preset app removed and added again on A (B asleep) keeps its accounts and sessions everywhere', async () => {
    await on('A', async () => {
      const created = await addApp(supabase());
      await addAccount(created.id, 'acc_one', { email: 'one@acme.test' });
      await syncOn();
    });
    await on('B', syncOn);
    const appId = await on('A', async () => {
      await removeApp((await readState()).apps[0]!.id);
      await syncNow();
      const again = await addApp(supabase());
      await addAccount(again.id, 'acc_two', { email: 'two@acme.test', capturedAt: Date.now() });
      await storeSnapshot('acc_two', snapshot('a-token'));
      await syncNow();
      return again.id;
    });
    await on('B', async () => {
      await syncNow();
      const state = await readState();
      expect(state.apps.map((item) => item.id)).toEqual([appId]);
      expect(state.accounts.map((item) => item.id)).toEqual(['acc_two']);
    });
    await on('A', async () => {
      await syncNow();
      const state = await readState();
      expect(state.apps.map((item) => item.id)).toEqual([appId]);
      expect(state.accounts.map((item) => item.id)).toEqual(['acc_two']);
      expect(await readStoredSnapshot('acc_two')).not.toBeNull();
    });
  });

  it('R1c: a workspace removed and made again with the same name on A (B asleep) stays everywhere', async () => {
    await on('A', async () => {
      const created = await addApp(custom());
      await addAccount(created.id, 'acc_work');
      await saveWorkspace(undefined, { name: 'Acme', color: '#c8402b', members: {}, links: [] });
      await syncOn();
    });
    await on('B', syncOn);
    const id = await on('A', async () => {
      await removeWorkspace((await readState()).workspaces[0]!.id);
      await syncNow();
      const made = await saveWorkspace(undefined, { name: 'Acme', color: '#c8402b', members: {}, links: [] });
      await syncNow();
      return made.id;
    });
    await on('B', async () => {
      await syncNow();
      expect((await readState()).workspaces.map((item) => item.id)).toEqual([id]);
    });
    await on('A', async () => {
      await syncNow();
      expect((await readState()).workspaces.map((item) => item.id)).toEqual([id]);
    });
  });

  it('settles a removal against the keys applied in the same pull', () => {
    const remote: Record<string, SyncItem> = {
      'sd1:c:acc_a': { gone: true, t: 2, by: 'A' },
      'sd1:c:acc_c': { v: {}, t: 3, by: 'C' },
    };
    const deletes = [{ kind: 'account' as const, id: 'acc_x', key: 'sd1:c:acc_a' }];
    // acc_c was applied to acc_x in this pull: it still stands for it, so only the tombstone's key goes.
    const applied = { 'sd1:c:acc_c': { hash: 'h', t: 3, by: 'C', local: 'acc_x' } };
    expect(settleDeletes(deletes, remote, applied)).toEqual({ deletes: [], forget: ['sd1:c:acc_a'] });
    expect(settleDeletes(deletes, remote, {})).toEqual({ deletes, forget: [] });
  });
});

describe('sync: edits on two computers (R2)', () => {
  it('R2: an edit made on A while offline survives an unrelated change of the same account on B', async () => {
    const appId = await on('A', async () => {
      const created = await addApp(custom());
      await addAccount(created.id, 'acc_work');
      await addAccount(created.id, 'acc_two');
      await syncOn();
      return created.id;
    });
    await on('B', syncOn);
    // A is offline: the user writes a note (no sync happens).
    await on('A', async () => {
      await updateAccount('acc_work', { note: 'Billing owner, do not delete' });
    });
    // Meanwhile B only reorders the accounts of the app.
    await on('B', async () => {
      await reorderAccounts(appId, ['acc_two', 'acc_work']);
      await syncNow();
    });
    await on('A', async () => {
      await syncNow();
      const work = (await readState()).accounts.find((item) => item.id === 'acc_work');
      expect(work).toMatchObject({ note: 'Billing owner, do not delete', order: 1 });
    });
    // The merged account went back to B too.
    await on('B', async () => {
      await syncNow();
      const work = (await readState()).accounts.find((item) => item.id === 'acc_work');
      expect(work).toMatchObject({ note: 'Billing owner, do not delete', order: 1 });
    });
  });

  it('R2: a memo written before 1.7 (no common ground yet) gets it at the next sync', async () => {
    const appId = await on('A', async () => {
      const created = await addApp(custom());
      await addAccount(created.id, 'acc_work');
      await addAccount(created.id, 'acc_two');
      await syncOn();
      return created.id;
    });
    await on('B', syncOn);
    await on('A', async () => {
      // As 1.6 left it: no `base` in any memo entry.
      const memo = (await chrome.storage.local.get('sd:syncMemo'))['sd:syncMemo'] as Record<string, object>;
      const stripped = Object.fromEntries(
        Object.entries(memo).map(([key, entry]) => {
          const { base: _base, ...rest } = entry as { base?: unknown };
          return [key, rest];
        }),
      );
      await chrome.storage.local.set({ 'sd:syncMemo': stripped });
      await syncNow(); // nothing changed anywhere: the memo gets its common ground back
      await updateAccount('acc_work', { note: 'Written offline' });
    });
    await on('B', async () => {
      await reorderAccounts(appId, ['acc_two', 'acc_work']);
      await syncNow();
    });
    await on('A', async () => {
      await syncNow();
      expect((await readState()).accounts.find((item) => item.id === 'acc_work')?.note).toBe('Written offline');
    });
  });

  it('R2: when both computers change the same field, the incoming write wins and both end up equal', async () => {
    await on('A', async () => {
      const created = await addApp(custom());
      await addAccount(created.id, 'acc_work');
      await syncOn();
    });
    await on('B', syncOn);
    await on('A', () => updateAccount('acc_work', { label: 'From A' }));
    await on('B', async () => {
      await updateAccount('acc_work', { label: 'From B' });
      await syncNow();
    });
    await on('A', async () => {
      await syncNow();
      expect(await labels()).toEqual(['From B']);
    });
    await on('B', async () => {
      await syncNow();
      expect(await labels()).toEqual(['From B']);
    });
  });

  it('R2: workspace links added offline survive a reorder of workspaces elsewhere', async () => {
    await on('A', async () => {
      await addApp(custom());
      await saveWorkspace(undefined, { name: 'One', color: '#c8402b', members: {}, links: [] });
      await saveWorkspace(undefined, { name: 'Two', color: '#c8402b', members: {}, links: [] });
      await syncOn();
    });
    await on('B', syncOn);
    await on('A', async () => {
      const one = (await readState()).workspaces.find((item) => item.name === 'One')!;
      await saveWorkspace(one.id, {
        name: 'One',
        color: '#c8402b',
        members: {},
        links: [{ id: 'l1', title: 'Billing', url: 'https://acme.test/billing' }],
      });
    });
    await on('B', async () => {
      const ids = (await readState()).workspaces.map((item) => item.id);
      await reorderWorkspaces([...ids].reverse());
      await syncNow();
    });
    for (const name of ['A', 'B']) {
      await on(name, async () => {
        await syncNow();
        const one = (await readState()).workspaces.find((item) => item.name === 'One');
        expect(one?.links.map((link) => link.url)).toEqual(['https://acme.test/billing']);
        expect(one?.order).toBe(1);
      });
    }
  });

  it('merges field by field: changed here and not there keeps the value here', () => {
    const base = { label: 'Work', note: 'old', order: 0 };
    expect(
      mergeFields({ label: 'Mine', note: 'old', order: 0 }, base, { label: 'Work', note: 'new', order: 3 }),
    ).toEqual({ label: 'Mine', note: 'new', order: 3 });
    // Removed here, untouched there: stays removed. Changed on both sides: theirs.
    expect(mergeFields({ label: 'Mine', order: 0 }, base, { label: 'Theirs', note: 'old', order: 0 })).toEqual({
      label: 'Theirs',
      order: 0,
    });
  });
});

describe('sync: workspace members not here yet (R3)', () => {
  it('R3: keeps a member whose account is too big to sync, and shows it once the account arrives', async () => {
    const appId = await on('A', async () => {
      const created = await addApp(custom());
      await addAccount(created.id, 'acc_big', { pins: bigPins });
      await saveWorkspace(undefined, {
        name: 'Acme',
        color: '#c8402b',
        members: { [created.id]: 'acc_big' },
        links: [],
      });
      await saveWorkspace(undefined, { name: 'Other', color: '#c8402b', members: {}, links: [] });
      await syncOn();
      return created.id;
    });
    await on('B', async () => {
      await syncOn();
      const acme = (await readState()).workspaces.find((item) => item.name === 'Acme');
      expect(acme?.members).toEqual({});
      expect(acme?.foreignMembers).toEqual({ [appId]: 'acc_big' });
      const ids = (await readState()).workspaces.map((item) => item.id);
      await reorderWorkspaces([...ids].reverse());
      await syncNow();
    });
    await on('A', async () => {
      await syncNow();
      const acme = (await readState()).workspaces.find((item) => item.name === 'Acme');
      expect(acme?.members).toEqual({ [appId]: 'acc_big' });
      // The account gets small enough to travel.
      await update((draft) => {
        draft.accounts[0]!.pins = [];
      });
      await syncNow();
    });
    await on('B', async () => {
      await syncNow();
      const acme = (await readState()).workspaces.find((item) => item.name === 'Acme');
      expect(acme?.members).toEqual({ [appId]: 'acc_big' });
      expect(acme).not.toHaveProperty('foreignMembers');
    });
  });

  it('a member waiting here goes when the computer that has it removes it', async () => {
    const appId = await on('A', async () => {
      const created = await addApp(custom());
      await addAccount(created.id, 'acc_big', { pins: bigPins });
      await addAccount(created.id, 'acc_small');
      await saveWorkspace(undefined, {
        name: 'Acme',
        color: '#c8402b',
        members: { [created.id]: 'acc_big' },
        links: [],
      });
      await syncOn();
      return created.id;
    });
    await on('B', async () => {
      await syncOn();
      expect((await readState()).workspaces[0]?.foreignMembers).toEqual({ [appId]: 'acc_big' });
    });
    await on('A', async () => {
      const ws = (await readState()).workspaces[0]!;
      await saveWorkspace(ws.id, { name: 'Acme', color: '#c8402b', members: { [appId]: 'acc_small' }, links: [] });
      await syncNow();
    });
    await on('B', async () => {
      await syncNow();
      const ws = (await readState()).workspaces[0];
      expect(ws?.members).toEqual({ [appId]: 'acc_small' });
      expect(ws).not.toHaveProperty('foreignMembers');
    });
  });

  it('never keeps a waiting member whose account or app was removed here on purpose', () => {
    const draft = {
      apps: [sanitizeApp({ ...custom(), id: 'app_acme', order: 0, createdAt: 1 })!],
      accounts: [account()],
      workspaces: [],
    };
    const upsert = {
      kind: 'workspace' as const,
      id: 'ws_1',
      key: 'sd1:w:ws_1',
      value: {
        id: 'ws_1',
        name: 'Acme',
        color: '#c8402b',
        links: [],
        members: { app_acme: 'acc_gone', app_other: 'acc_new' },
      },
      t: 1,
      by: 'A',
      retry: false,
      fields: [],
    };
    applyPull(draft, [upsert], {}, new Set(['sd1:c:acc_gone']));
    expect(draft.workspaces[0]).toMatchObject({ members: {}, foreignMembers: { app_other: 'acc_new' } });
  });
});

describe('sync: tombstones and the removal journal (R7, I3)', () => {
  it('R7: a computer whose clock runs 46 days fast does not drop a tombstone written a second ago', () => {
    const now = Date.now();
    const remote = { 'sd1:c:acc_x': { gone: true as const, t: now - 1000, by: 'other' } };
    const plan = planPush({}, {}, remote, new Set(), now + TOMBSTONE_TTL_MS + 24 * 3600 * 1000, 'fast-clock');
    expect(plan.drop).toEqual([]);
    // Nor one dated in the future by a fast writer: its age counts from when it was first seen here.
    const future = { 'sd1:c:acc_x': { gone: true as const, t: now + 90 * 24 * 3600 * 1000, by: 'other' } };
    const later = planPush({}, {}, future, new Set(), now + 2 * TOMBSTONE_TTL_MS, 'me', { 'sd1:c:acc_x': now });
    expect(later.drop).toEqual(['sd1:c:acc_x']);
    expect(planPush({}, {}, future, new Set(), now + 1000, 'me', { 'sd1:c:acc_x': now }).drop).toEqual([]);
  });

  it('I3: something removed here and sent back by a computer offline for months is removed again', async () => {
    await on('A', async () => {
      const created = await addApp(custom());
      await addAccount(created.id, 'acc_old');
      await addAccount(created.id, 'acc_keep');
      await syncOn();
    });
    await on('B', syncOn);
    await on('A', async () => {
      await removeAccount('acc_old');
      await syncNow();
    });
    // B stays offline past the tombstone's lifetime: the tombstone is gone from Chrome Sync…
    syncStore().delete('sd1:c:acc_old');
    // …and B, back online, sends the account again.
    await on('B', async () => {
      await syncNow();
      expect(syncStore().has('sd1:c:acc_old')).toBe(true);
    });
    await on('A', async () => {
      await syncNow();
      expect(await labels()).toEqual(['acc_keep']);
      expect((syncStore().get('sd1:c:acc_old') as SyncItem).gone).toBe(true);
    });
    await on('B', async () => {
      await syncNow();
      expect(await labels()).toEqual(['acc_keep']);
    });
  });
});

describe('sync: older versions (R8)', () => {
  it('reads what a writer knows from its schema number, and keeps the schema table in step', () => {
    // Bumping SYNC_SCHEMA without recording its fields would make this version misread its own items.
    expect(SCHEMA_FIELDS[SYNC_SCHEMA]).toEqual(SYNC_FIELDS);
    const item = (extra: Partial<SyncItem>): SyncItem => ({
      v: { label: 'A', linkRules: [] },
      t: 1,
      by: 'x',
      ...extra,
    });
    expect(writerFields('account', item({ s: SYNC_SCHEMA }))).toEqual(SYNC_FIELDS.account);
    // A newer version knows at least every field this one does.
    expect(writerFields('account', item({ s: SYNC_SCHEMA + 5 }))).toEqual(SYNC_FIELDS.account);
    // 1.5/1.6 (no schema, or garbage): the legacy list plus what the item carries.
    for (const s of [undefined, 1, 2.5, -1]) {
      const fields = writerFields('account', item(s === undefined ? {} : { s }));
      expect(fields).toEqual(expect.arrayContaining([...LEGACY_SYNC_FIELDS.account, 'linkRules']));
    }
    expect(writerFields('account', item({ v: { label: 'A' } }))).not.toContain('linkRules');
  });

  it('R8: link rules set on a newer computer survive a reorder on a computer still on 1.5.0', async () => {
    await on('A', async () => {
      const created = await addApp(custom());
      await addAccount(created.id, 'acc_work', { linkRules: ['acme.test/billing'] });
      await syncOn();
      expect((await readState()).accounts[0]?.linkRules).toEqual(['acme.test/billing']);
    });
    expect((syncStore().get('sd1:c:acc_work') as SyncItem).s).toBe(SYNC_SCHEMA);
    // A 1.5.0 computer (no `linkRules` in its ACCOUNT_SYNC_FIELDS, dropped by its sanitizeAccount, no `f`)
    // reorders the app's accounts and writes the whole item back, as its planPush does.
    const item = syncStore().get('sd1:c:acc_work') as { v: Record<string, unknown>; t: number };
    const { linkRules: _dropped, ...asOldVersionSeesIt } = item.v;
    syncStore().set('sd1:c:acc_work', {
      v: { ...asOldVersionSeesIt, order: 1 },
      t: item.t + 1,
      by: 'computer-on-1.5.0',
    });
    await on('A', async () => {
      await syncNow();
      expect((await readState()).accounts[0]).toMatchObject({ linkRules: ['acme.test/billing'], order: 1 });
    });
  });

  it('R8: link rules cleared on a computer that knows them are cleared everywhere', async () => {
    await on('A', async () => {
      const created = await addApp(custom());
      await addAccount(created.id, 'acc_work', { linkRules: ['acme.test/billing'] });
      await syncOn();
    });
    await on('B', async () => {
      await syncOn();
      await updateAccount('acc_work', { linkRules: [] });
      await syncNow();
    });
    await on('A', async () => {
      await syncNow();
      expect((await readState()).accounts[0]).not.toHaveProperty('linkRules');
    });
  });

  it('lists every field of an app as it travels', () => {
    const full: Required<AppDef> = {
      ...(sanitizeApp({ ...custom(), id: 'app_x', order: 0, createdAt: 1 }) as AppDef),
      presetId: 'none',
      loginUrl: 'https://acme.test/login',
      recentPattern: '/p/(\\d+)',
      titleSuffix: ' – Acme',
    };
    for (const field of Object.keys(full)) expect(APP_SYNC_FIELDS).toContain(field);
  });
});

describe('vault (R4, I1)', () => {
  it('R4: two concurrent "turn on the lock" requests leave every saved session readable', async () => {
    await update((draft) => {
      draft.accounts.push(account());
    });
    await storeSnapshot('acc_work', snapshot('secret'));
    const results = await Promise.allSettled([vaultCreate('passphrase one'), vaultCreate('passphrase one')]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: 'VAULT_EXISTS' },
    });
    await vaultLock();
    await vaultUnlock('passphrase one');
    await expect(loadSnapshot('acc_work')).resolves.toMatchObject({ storage: { localStorage: { token: 'secret' } } });
  });

  it('I1: changing the passphrase makes a new key pair and seals every session again', async () => {
    await update((draft) => {
      draft.accounts.push(account());
    });
    await storeSnapshot('acc_work', snapshot('first'));
    await vaultCreate('passphrase one');
    await storeSnapshot('acc_work', snapshot('second'));
    const oldKey = (await getPrivateKey())!;
    const oldPublic = (await readState()).vault!.publicKey;

    await vaultChange('passphrase one', 'passphrase two');
    expect((await readState()).vault!.publicKey).not.toBe(oldPublic);
    // The old private key (with the old passphrase) opens nothing saved any more…
    for (const previous of [false, true]) {
      const stored = await readStoredSnapshot('acc_work', previous);
      expect(stored && 'sealed' in stored).toBe(true);
      if (stored && 'sealed' in stored) await expect(unseal(stored.sealed, oldKey)).rejects.toThrow();
    }
    // …the new passphrase opens both.
    await vaultLock();
    await expect(vaultUnlock('passphrase one')).rejects.toMatchObject({ code: 'BAD_PASSPHRASE' });
    await vaultUnlock('passphrase two');
    expect((await loadSnapshot('acc_work')).storage.localStorage).toEqual({ token: 'second' });
    expect((await loadSnapshot('acc_work', true)).storage.localStorage).toEqual({ token: 'first' });
  });

  it('I1: unlocking refuses a vault whose two keys do not belong together', async () => {
    await vaultCreate('passphrase one');
    await vaultLock();
    const other = await createVault('passphrase one');
    const vault = (await readState()).vault!;
    await chrome.storage.local.set({ 'sd:vault': { ...vault, publicKey: other.meta.publicKey } });
    await expect(vaultUnlock('passphrase one')).rejects.toMatchObject({ code: 'CORRUPT' });
    expect(await getPrivateKey()).toBeNull();
  });
});

describe('backups and wipe (R5, R6)', () => {
  it('R5: importing a backup on a new computer does not claim the browser is signed in as an imported account', async () => {
    const app = await addApp(custom());
    await addAccount(app.id, 'acc_work', { capturedAt: Date.now() });
    await storeSnapshot('acc_work', snapshot('good-token'));
    await update((draft) => {
      draft.active[app.id] = 'acc_work';
    });
    const { text } = await exportBackup('backup password', true);
    await wipeData(); // the new computer: nothing saved, the browser not signed in to acme.test

    for (const mode of ['merge', 'replace'] as const) {
      await importBackup(text, 'backup password', mode);
      const state = await readState();
      const imported = state.apps[0]!;
      expect(state.active[imported.id]).toBeUndefined();
      // So the first switch away keeps a signed-out live session apart instead of overwriting the import.
      const decision = decideSave({
        accounts: state.accounts,
        activeId: state.active[imported.id],
        detector: imported.detector,
        identity: null,
        empty: false,
      });
      expect(decision.kind).not.toBe('active');
    }
  });

  it('R6: a save that finishes just after "Delete all data" leaves no sign-in behind', async () => {
    await update((draft) => {
      draft.accounts.push(account());
    });
    await vaultCreate('passphrase one');
    await wipeData();
    // persist() of a switch or auto-sync that was already running reaches storeSnapshot now.
    await storeSnapshot('acc_work', snapshot('late-token'));
    expect(await chrome.storage.local.get('sd:snap:acc_work')).toEqual({});
  });
});

describe('settings (R9)', () => {
  it('R9: a missing or malformed auto-lock value (e.g. null in a backup) never turns auto-lock off', () => {
    for (const value of [null, '', [], false, '15']) {
      expect(parseSettings({ autoLockMinutes: value }).autoLockMinutes).toBe(30);
    }
    expect(parseSettings({ autoLockMinutes: 0 }).autoLockMinutes).toBe(0);
    expect(parseSettings({ autoLockMinutes: 15 }).autoLockMinutes).toBe(15);
  });
});

describe('messages (I4)', () => {
  const page = (path: string) => `chrome-extension://${chrome.runtime.id}/${path}`;
  const origin = `chrome-extension://${chrome.runtime.id}`;

  it('I4: answers only the extension’s own pages', () => {
    // The popup, the side panel, the manager (also when opened in a tab), the confirmation window.
    expect(fromOwnPage({ id: chrome.runtime.id, url: page('popup/popup.html'), origin })).toBe(true);
    expect(fromOwnPage({ id: chrome.runtime.id, url: page('sidepanel/sidepanel.html'), origin })).toBe(true);
    expect(
      fromOwnPage({
        id: chrome.runtime.id,
        url: page('options/options.html#/security'),
        origin,
        tab: { url: page('options/options.html') } as chrome.tabs.Tab,
      }),
    ).toBe(true);
    // A script of ours in a web page, in a frame of a page whose tab address we can't see, or in a
    // non-web tab; another extension.
    expect(
      fromOwnPage({
        id: chrome.runtime.id,
        url: 'https://acme.test/',
        origin: 'https://acme.test',
        tab: { url: 'https://acme.test/' } as chrome.tabs.Tab,
      }),
    ).toBe(false);
    expect(fromOwnPage({ id: chrome.runtime.id, url: 'https://frame.test/', tab: {} as chrome.tabs.Tab })).toBe(false);
    expect(
      fromOwnPage({
        id: chrome.runtime.id,
        url: 'file:///tmp/x.html',
        tab: { url: 'file:///tmp/x.html' } as chrome.tabs.Tab,
      }),
    ).toBe(false);
    expect(fromOwnPage({ id: 'other-extension', url: 'chrome-extension://other-extension/x.html' })).toBe(false);
    expect(fromOwnPage({ id: chrome.runtime.id })).toBe(false);
    expect(fromOwnPage({ id: chrome.runtime.id, url: page('popup/popup.html'), origin: 'null' })).toBe(false);
  });
});

describe('untrusted ids and keys (I5)', () => {
  it('I5: never takes "__proto__", "constructor" or "prototype" as an id', () => {
    for (const id of ['__proto__', 'constructor', 'prototype']) {
      expect(sanitizeAccount({ ...account(), id })).toBeNull();
      expect(sanitizeAccount({ ...account(), appId: id })).toBeNull();
      expect(sanitizeApp({ ...custom(), id, order: 0, createdAt: 1 })).toBeNull();
      expect(sanitizeWorkspace({ id, name: 'X', members: {}, links: [] })).toBeNull();
    }
    const members = JSON.parse('{"__proto__": "acc_x", "constructor": "acc_y", "app_ok": "acc_ok"}') as unknown;
    expect({ ...sanitizeWorkspace({ id: 'ws_1', name: 'X', members, links: [] })!.members }).toEqual({
      app_ok: 'acc_ok',
    });
    const active = sanitizeActive(JSON.parse('{"__proto__": null, "app_ok": "acc_ok"}'));
    expect(Object.keys(active)).toEqual(['app_ok']);
    expect(active.toString).toBeUndefined();
  });

  it('I5: a backup with a "__proto__" session or a page with a "__proto__" key changes no prototype', () => {
    // As it reads in a file: "__proto__" is an ordinary key of the JSON text.
    const text = JSON.stringify({
      apps: [{ ...custom(), id: 'app_acme', order: 0, createdAt: 1 }],
      accounts: [account(), account({ id: 'PROTO' })],
      sessions: { PROTO: snapshot('x'), acc_work: snapshot('y') },
      workspaces: [],
      active: {},
      settings: {},
    }).replaceAll('"PROTO"', '"__proto__"');
    const payload = sanitizePayload(JSON.parse(text));
    expect(payload.accounts.map((item) => item.id)).toEqual(['acc_work']);
    expect(Object.keys(payload.sessions)).toEqual(['acc_work']);
    expect(Object.getPrototypeOf(payload.sessions)).toBeNull();
    expect((payload.sessions as Record<string, unknown>).cookies).toBeUndefined();

    const dump = sanitizeStorageDump({ localStorage: JSON.parse('{"__proto__": "kept", "token": "t"}') });
    expect(Object.keys(dump.localStorage!).sort()).toEqual(['__proto__', 'token']);
    expect(dump.localStorage!['__proto__']).toBe('kept');
  });
});
