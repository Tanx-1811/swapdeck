import { beforeEach, describe, expect, it } from 'vitest';
import {
  addApp,
  addApps,
  removeWorkspace,
  saveWorkspace,
  workspaceFromActive,
  exportBackup,
  importBackup,
  inspectBackup,
  removeAccount,
  removeApp,
  reorderAccounts,
  updateAccount,
  updateApp,
  vaultChange,
  vaultCreate,
  vaultDisable,
  vaultLock,
  vaultReset,
  vaultUnlock,
  wipeData,
} from '../../src/background/admin';
import { getPrivateKey, loadSnapshot, readStoredSnapshot, storeSnapshot, update } from '../../src/background/state';
import type { Snapshot } from '../../src/core/types';
import type { AppInput } from '../../src/shared/protocol';
import { readState } from '../../src/shared/store';

const input = (overrides: Partial<AppInput> = {}): AppInput => ({
  name: 'Acme',
  color: '#e8590c',
  domains: ['acme.test'],
  origin: 'https://acme.test',
  homeUrl: 'https://acme.test/',
  stagingPath: '/robots.txt',
  storage: { cookies: true, localStorage: true, sessionStorage: false, indexedDB: false },
  detector: { kind: 'auto' },
  ...overrides,
});

const snapshot = (value: string): Snapshot => ({
  v: 1,
  capturedAt: Date.now(),
  origin: 'https://acme.test',
  cookies: [],
  storage: { localStorage: { token: value } },
});

async function addAccount(appId: string, id: string, extra: Record<string, unknown> = {}) {
  await update((draft) => {
    draft.accounts.push({
      id,
      appId,
      label: id,
      color: '#6d4cff',
      pins: [],
      recents: [],
      order: draft.accounts.length,
      createdAt: 0,
      switchCount: 0,
      ...extra,
    });
  });
}

beforeEach(async () => {
  await chrome.storage.local.clear();
  await chrome.storage.session.clear();
});

describe('apps', () => {
  it('adds, updates and removes apps, refusing clashes and blocked sites', async () => {
    const app = await addApp(input());
    expect(app.id).toMatch(/^app_/);
    await expect(
      addApp(input({ name: 'Other', domains: ['app.acme.test'], origin: 'https://app.acme.test' })),
    ).rejects.toMatchObject({
      code: 'INVALID',
      detail: 'overlap:Acme',
    });
    await expect(addApp(input({ domains: ['google.com'], origin: 'https://google.com' }))).rejects.toMatchObject({
      code: 'BLOCKED_DOMAIN',
    });
    await expect(addApp(input({ domains: ['other.test'], origin: 'https://acme.test' }))).rejects.toMatchObject({
      code: 'INVALID',
      detail: 'origin',
    });

    const updated = await updateApp(app.id, { name: 'Acme Cloud', recentPattern: '^/p/(\\w+)' });
    expect(updated).toMatchObject({ name: 'Acme Cloud', recentPattern: '^/p/(\\w+)' });
    expect((await updateApp(app.id, { recentPattern: '' })).recentPattern).toBeUndefined();

    await addAccount(app.id, 'acc_a');
    await storeSnapshot('acc_a', snapshot('a'));
    await removeApp(app.id);
    const state = await readState();
    expect(state.apps).toEqual([]);
    expect(state.accounts).toEqual([]);
    expect(await readStoredSnapshot('acc_a')).toBeNull();
    expect(chrome.permissions.remove).toHaveBeenCalledWith({ origins: ['*://*.acme.test/*'] });
  });

  it('returns the existing app when a preset is added twice', async () => {
    const first = await addApp(input({ presetId: 'acme' }));
    const second = await addApp(input({ presetId: 'acme', name: 'Again' }));
    expect(second.id).toBe(first.id);
  });
});

describe('accounts', () => {
  it('edits, reorders and deletes accounts', async () => {
    const app = await addApp(input());
    await addAccount(app.id, 'acc_a');
    await addAccount(app.id, 'acc_b');
    await update((draft) => {
      draft.active[app.id] = 'acc_a';
    });

    const edited = await updateAccount('acc_a', {
      label: '  Work ',
      icon: 'briefcase',
      homeUrl: 'https://acme.test/home',
    });
    expect(edited).toMatchObject({ label: 'Work', icon: 'briefcase', homeUrl: 'https://acme.test/home' });
    // Unknown symbols are dropped, never stored.
    expect(await updateAccount('acc_a', { icon: 'skull' as never })).not.toHaveProperty('icon');
    expect(await updateAccount('acc_a', { icon: 'leaf', clear: ['icon', 'homeUrl'] })).not.toHaveProperty('icon');
    expect(await updateAccount('acc_a', { important: true })).toMatchObject({ important: true });
    expect(await updateAccount('acc_a', { clear: ['important'] })).not.toHaveProperty('important');
    // Only optional fields can be cleared.
    expect(await updateAccount('acc_a', { clear: ['label' as never] })).toMatchObject({ label: 'Work' });
    await expect(updateAccount('acc_a', { label: '' })).rejects.toMatchObject({ code: 'INVALID' });

    await reorderAccounts(app.id, ['acc_b', 'acc_a']);
    expect((await readState()).accounts.map((account) => account.id)).toEqual(['acc_b', 'acc_a']);

    await removeAccount('acc_a');
    const state = await readState();
    expect(state.accounts.map((account) => account.id)).toEqual(['acc_b']);
    expect(state.active[app.id]).toBeNull();
  });
});

describe('saved sessions', () => {
  it('keeps the previous session when a new one is saved', async () => {
    await addAccount('app_acme', 'acc_a');
    await storeSnapshot('acc_a', snapshot('one'));
    await storeSnapshot('acc_a', snapshot('two'));
    expect((await loadSnapshot('acc_a')).storage.localStorage).toEqual({ token: 'two' });
    expect((await loadSnapshot('acc_a', true)).storage.localStorage).toEqual({ token: 'one' });
  });

  it('only writes the parts of the state that changed', async () => {
    await update((draft) => {
      draft.settings.badge = false;
    });
    const raw = await chrome.storage.local.get(null);
    expect(Object.keys(raw)).toEqual(['sd:settings']);
  });
});

describe('vault', () => {
  it('seals existing and new sessions, and locks restoring', async () => {
    await addAccount('app_acme', 'acc_a');
    await storeSnapshot('acc_a', snapshot('before'));
    await vaultCreate('correct horse battery');
    const raw = JSON.stringify(await chrome.storage.local.get(null));
    expect(raw).not.toContain('before');
    expect(await getPrivateKey()).toBeTruthy();
    expect((await loadSnapshot('acc_a')).storage.localStorage).toEqual({ token: 'before' });

    await vaultLock();
    await storeSnapshot('acc_a', snapshot('while-locked'));
    expect(JSON.stringify(await chrome.storage.local.get(null))).not.toContain('while-locked');
    await expect(loadSnapshot('acc_a')).rejects.toMatchObject({ code: 'LOCKED' });

    await expect(vaultUnlock('nope nope nope')).rejects.toMatchObject({ code: 'BAD_PASSPHRASE' });
    await vaultUnlock('correct horse battery');
    expect((await loadSnapshot('acc_a')).storage.localStorage).toEqual({ token: 'while-locked' });
  });

  it('changes the passphrase, turns off, and resets', async () => {
    await expect(vaultCreate('short')).rejects.toMatchObject({ code: 'INVALID' });
    await vaultCreate('first passphrase');
    await expect(vaultCreate('second passphrase')).rejects.toMatchObject({ code: 'VAULT_EXISTS' });
    const app = await addApp(input());
    await addAccount(app.id, 'acc_a');
    await storeSnapshot('acc_a', snapshot('secret'));

    await vaultChange('first passphrase', 'second passphrase');
    await vaultLock();
    await vaultUnlock('second passphrase');

    await vaultDisable('second passphrase');
    expect(JSON.stringify(await chrome.storage.local.get(null))).toContain('secret');
    expect((await readState()).vault).toBeNull();

    await vaultCreate('third passphrase');
    await update((draft) => {
      Object.assign(draft.accounts[0]!, {
        capturedAt: 5,
        stats: { cookies: 1, storageKeys: 1, databases: 0, bytes: 10 },
      });
    });
    await vaultReset();
    expect(await readStoredSnapshot('acc_a')).toBeNull();
    const state = await readState();
    expect(state.vault).toBeNull();
    expect(state.accounts[0]).not.toHaveProperty('capturedAt');
  });

  it('drops a session that can no longer be decrypted: off means nothing saved, and backups leave it out', async () => {
    const app = await addApp(input());
    await addAccount(app.id, 'acc_ok', { label: 'Fine', capturedAt: 5 });
    await addAccount(app.id, 'acc_bad', {
      label: 'Broken',
      capturedAt: 5,
      stats: { cookies: 1, storageKeys: 1, databases: 0, bytes: 10 },
    });
    await vaultCreate('first passphrase');
    await storeSnapshot('acc_ok', snapshot('fine'));
    await storeSnapshot('acc_bad', snapshot('broken'));
    // Damage one sealed session (a bad disk write, a bug in an old version…).
    const raw = (await chrome.storage.local.get('sd:snap:acc_bad'))['sd:snap:acc_bad'] as {
      sealed: { data: string };
    };
    raw.sealed.data = raw.sealed.data.slice(0, -8) + 'AAAAAAAA';
    await chrome.storage.local.set({ 'sd:snap:acc_bad': raw });

    // A backup with sessions still comes out, without the broken one, and says whose is missing.
    const backup = await exportBackup('backup password', true);
    expect(backup.unreadable).toEqual(['Broken']);
    expect((await inspectBackup(backup.text, 'backup password')).sessions).toBe(1);

    await vaultDisable('first passphrase');
    expect(await readStoredSnapshot('acc_bad')).toBeNull();
    expect((await loadSnapshot('acc_ok')).storage.localStorage).toEqual({ token: 'fine' });
    const accounts = (await readState()).accounts;
    expect(accounts.find((item) => item.id === 'acc_bad')).not.toHaveProperty('capturedAt');
    expect(accounts.find((item) => item.id === 'acc_bad')).not.toHaveProperty('stats');
    expect(accounts.find((item) => item.id === 'acc_ok')?.capturedAt).toBe(5);
  });
});

describe('backups', () => {
  it('exports with sessions only behind a password, and imports by merging', async () => {
    const app = await addApp(input());
    await addAccount(app.id, 'acc_a', { email: 'a@acme.test', capturedAt: 1 });
    await storeSnapshot('acc_a', snapshot('exported'));
    await expect(exportBackup(null, true)).rejects.toMatchObject({ code: 'INVALID' });

    const { text } = await exportBackup('backup password', true);
    expect(text).not.toContain('exported');

    await wipeData();
    expect((await readState()).apps).toEqual([]);
    await expect(importBackup(text, 'wrong password', 'merge')).rejects.toMatchObject({ code: 'BAD_PASSPHRASE' });
    expect(await importBackup(text, 'backup password', 'merge')).toEqual({
      apps: 1,
      accounts: 1,
      sessions: 1,
      workspaces: 0,
      skipped: [],
      syncOff: false,
    });
    const state = await readState();
    expect(state.apps[0]?.name).toBe('Acme');
    const accountId = state.accounts[0]!.id;
    expect((await loadSnapshot(accountId)).storage.localStorage).toEqual({ token: 'exported' });

    // Importing again matches the same app and account instead of duplicating them.
    expect(await importBackup(text, 'backup password', 'merge')).toEqual({
      apps: 0,
      accounts: 0,
      sessions: 0,
      workspaces: 0,
      skipped: [],
      syncOff: false,
    });
  });

  it('replaces everything, keeping ids', async () => {
    const app = await addApp(input());
    await addAccount(app.id, 'acc_a');
    const { text } = await exportBackup(null, false);
    await addApp(
      input({ name: 'Other', domains: ['other.test'], origin: 'https://other.test', homeUrl: 'https://other.test/' }),
    );
    expect(await importBackup(text, undefined, 'replace')).toEqual({
      apps: 1,
      accounts: 1,
      sessions: 0,
      workspaces: 0,
      skipped: [],
      syncOff: false,
    });
    const state = await readState();
    expect(state.apps.map((item) => item.id)).toEqual([app.id]);
    expect(state.accounts.map((item) => item.id)).toEqual(['acc_a']);
  });

  it('files accounts of an app set up here with another main address under that app, without its sign-ins', async () => {
    const there = await addApp(input({ origin: 'https://www.acme.test', homeUrl: 'https://www.acme.test/' }));
    await addAccount(there.id, 'acc_b', { email: 'b@acme.test', capturedAt: 1 });
    await storeSnapshot('acc_b', snapshot('from-www'));
    const { text } = await exportBackup('backup password', true);
    await wipeData();
    const here = await addApp(input({ origin: 'https://app.acme.test', homeUrl: 'https://app.acme.test/' }));

    expect(await importBackup(text, 'backup password', 'merge')).toMatchObject({ apps: 0, accounts: 1, sessions: 0 });
    const state = await readState();
    expect(state.apps.map((item) => item.id)).toEqual([here.id]);
    expect(state.accounts).toHaveLength(1);
    expect(state.accounts[0]).toMatchObject({ appId: here.id, email: 'b@acme.test' });
    expect(state.accounts[0]).not.toHaveProperty('capturedAt');
  });
});

describe('workspaces', () => {
  it('saves workspaces, drops members that point nowhere, and follows deletions', async () => {
    const acme = await addApp(input());
    const other = await addApp(
      input({ name: 'Other', domains: ['other.test'], origin: 'https://other.test', homeUrl: 'https://other.test/' }),
    );
    await addAccount(acme.id, 'acc_a');
    await addAccount(other.id, 'acc_b');
    const workspace = await saveWorkspace(undefined, {
      name: '  Client ',
      color: '#123456',
      emoji: '🤝',
      members: { [acme.id]: 'acc_a', [other.id]: 'acc_b', app_gone: 'acc_x', [acme.id + 'x']: 'acc_b' },
      links: [
        { id: 'pin_1', title: 'Board', url: 'https://acme.test/board' },
        { id: 'pin_2', title: 'Bad', url: 'javascript:x' },
      ],
    });
    expect(workspace).toMatchObject({
      name: 'Client',
      emoji: '🤝',
      members: { [acme.id]: 'acc_a', [other.id]: 'acc_b' },
    });
    expect(workspace.links).toHaveLength(1);

    const renamed = await saveWorkspace(workspace.id, { ...workspace, name: 'Client A', emoji: undefined });
    expect(renamed).toMatchObject({ id: workspace.id, name: 'Client A', createdAt: workspace.createdAt });
    expect(renamed).not.toHaveProperty('emoji');

    await removeAccount('acc_b');
    expect((await readState()).workspaces[0]!.members).toEqual({ [acme.id]: 'acc_a' });
    await removeApp(acme.id);
    expect((await readState()).workspaces[0]!.members).toEqual({});

    await removeWorkspace(workspace.id);
    expect((await readState()).workspaces).toEqual([]);
    await expect(
      saveWorkspace('ws_missing', { name: 'x', color: '#123456', members: {}, links: [] }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('makes a workspace from the accounts in use', async () => {
    const acme = await addApp(input());
    await addAccount(acme.id, 'acc_a');
    await expect(workspaceFromActive('Empty')).rejects.toMatchObject({ code: 'NO_SESSION' });
    await update((draft) => {
      draft.active[acme.id] = 'acc_a';
    });
    expect((await workspaceFromActive('Now')).members).toEqual({ [acme.id]: 'acc_a' });
  });

  it('adds many apps at once, keeping presets already added', async () => {
    const first = await addApp(input({ presetId: 'acme' }));
    const apps = await addApps([
      input({ presetId: 'acme' }),
      input({ name: 'Other', domains: ['other.test'], origin: 'https://other.test', homeUrl: 'https://other.test/' }),
    ]);
    expect(apps[0]!.id).toBe(first.id);
    expect((await readState()).apps).toHaveLength(2);
  });

  it('travel in backups with their accounts', async () => {
    const acme = await addApp(input());
    await addAccount(acme.id, 'acc_a', { email: 'a@acme.test' });
    await saveWorkspace(undefined, { name: 'Acme', color: '#123456', members: { [acme.id]: 'acc_a' }, links: [] });
    const { text } = await exportBackup(null, false);
    await wipeData();
    expect(await importBackup(text, undefined, 'merge')).toMatchObject({ workspaces: 1 });
    const state = await readState();
    expect(state.workspaces[0]!.members).toEqual({ [state.apps[0]!.id]: state.accounts[0]!.id });
    // Importing again doesn't duplicate the workspace.
    expect(await importBackup(text, undefined, 'merge')).toMatchObject({ workspaces: 0 });
  });
});
