import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  dropLaneData,
  probePage,
  readPageStorage,
  showOverlay,
  showRibbon,
  showToast,
  writePageStorage,
} from '../../src/background/page-scripts';
import type { IdbDatabaseDump } from '../../src/core/types';

function open(name: string, version: number, upgrade: (db: IDBDatabase) => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = () => upgrade(request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getAll(db: IDBDatabase, store: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(store).objectStore(store).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function deleteAll() {
  for (const info of await indexedDB.databases()) {
    if (info.name) {
      await new Promise((resolve) => {
        const request = indexedDB.deleteDatabase(info.name!);
        request.onsuccess = request.onerror = request.onblocked = resolve;
      });
    }
  }
}

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  await deleteAll();
});

describe('web storage', () => {
  it('reads and replaces local and session storage', async () => {
    localStorage.setItem('token', 'old');
    localStorage.setItem('theme', 'dark');
    sessionStorage.setItem('tab', '1');
    const read = await readPageStorage({ local: true, session: true, idb: false, idbLimitBytes: 0 });
    expect(read).toMatchObject({
      origin: location.origin,
      local: { token: 'old', theme: 'dark' },
      session: { tab: '1' },
    });

    const result = await writePageStorage(
      { local: { token: 'new' }, session: {} },
      { local: true, session: true, idb: false },
    );
    expect(result.errors).toEqual([]);
    expect({ ...localStorage }).toEqual({ token: 'new' });
    expect(sessionStorage.length).toBe(0);
  });

  it('touches nothing when the page is not on the expected origin (the tab moved mid-switch)', async () => {
    localStorage.setItem('draft', 'keep me');
    sessionStorage.setItem('tab', '1');
    const result = await writePageStorage(
      { local: { token: 'other-site' }, session: {} },
      { local: true, session: true, idb: false, expectedOrigin: 'https://elsewhere.test' },
    );
    expect(result).toEqual({ origin: location.origin, errors: [] });
    expect({ ...localStorage }).toEqual({ draft: 'keep me' });
    expect(sessionStorage.getItem('tab')).toBe('1');

    const read = await readPageStorage({
      local: true,
      session: true,
      idb: false,
      idbLimitBytes: 0,
      expectedOrigin: 'https://elsewhere.test',
    });
    expect(read.local).toBeUndefined();
    expect(read.session).toBeUndefined();
    expect(
      (
        await writePageStorage(
          { local: {} },
          { local: true, session: false, idb: false, expectedOrigin: location.origin },
        )
      ).errors,
    ).toEqual([]);
    expect(localStorage.length).toBe(0);
  });

  it('leaves storage kinds that are not part of the session alone', async () => {
    sessionStorage.setItem('keep', 'me');
    await writePageStorage({ local: {} }, { local: true, session: false, idb: false });
    expect(sessionStorage.getItem('keep')).toBe('me');
  });
});

describe('IndexedDB', () => {
  it('round-trips databases, stores, indexes, keys and rich values', async () => {
    const db = await open('app-db', 3, (handle) => {
      const users = handle.createObjectStore('users', { keyPath: 'id' });
      users.createIndex('by-email', 'email', { unique: true });
      handle.createObjectStore('kv');
      handle.createObjectStore('auto', { autoIncrement: true });
    });
    const tx = db.transaction(['users', 'kv', 'auto'], 'readwrite');
    tx.objectStore('users').put({
      id: 'u1',
      email: 'a@b.co',
      created: new Date(1_700_000_000_000),
      tags: new Set(['x']),
      meta: new Map([['k', 1]]),
      $t: 'not a tag',
      big: 12n,
    });
    tx.objectStore('kv').put(new Uint8Array([1, 2, 3]), ['compound', 1]);
    tx.objectStore('kv').put({ nested: [1, { deep: true }], inf: Infinity, nothing: undefined }, 'plain');
    tx.objectStore('auto').put('first');
    await new Promise((resolve) => (tx.oncomplete = resolve));
    db.close();

    const read = await readPageStorage({ local: false, session: false, idb: true, idbLimitBytes: 1_000_000 });
    expect(read.idbError).toBeUndefined();
    const dump = JSON.parse(JSON.stringify(read.idb));
    expect(dump).toHaveLength(1);

    await deleteAll();
    const result = await writePageStorage({ idb: dump }, { local: false, session: false, idb: true });
    expect(result.errors).toEqual([]);

    const restored = await open('app-db', 3, () => undefined);
    expect(restored.version).toBe(3);
    expect([...restored.objectStoreNames].sort()).toEqual(['auto', 'kv', 'users']);
    const [user] = (await getAll(restored, 'users')) as Record<string, unknown>[];
    expect(user!.created).toEqual(new Date(1_700_000_000_000));
    expect(user!.tags).toEqual(new Set(['x']));
    expect(user!.meta).toEqual(new Map([['k', 1]]));
    expect(user!.$t).toBe('not a tag');
    expect(user!.big).toBe(12n);
    expect(restored.transaction('users').objectStore('users').index('by-email').unique).toBe(true);
    try {
      const kv = await getAll(restored, 'kv');
      // The fake IndexedDB clones into another realm, so compare by tag and contents.
      const bytes = kv.find((value) => ArrayBuffer.isView(value)) as Uint8Array;
      expect(Object.prototype.toString.call(bytes)).toBe('[object Uint8Array]');
      expect(Array.from(bytes)).toEqual([1, 2, 3]);
      expect(kv).toContainEqual({ nested: [1, { deep: true }], inf: Infinity, nothing: undefined });
      expect(await getAll(restored, 'auto')).toEqual(['first']);
    } finally {
      restored.close();
    }
  });

  it('gives up on databases larger than the limit', async () => {
    const db = await open('big', 1, (handle) => handle.createObjectStore('s'));
    const tx = db.transaction('s', 'readwrite');
    tx.objectStore('s').put('x'.repeat(5000), 1);
    await new Promise((resolve) => (tx.oncomplete = resolve));
    db.close();
    const read = await readPageStorage({ local: false, session: false, idb: true, idbLimitBytes: 1000 });
    expect(read.idbError).toMatch(/larger than/);
  });

  it('never rebuilds arbitrary constructors from saved data', async () => {
    const dump: IdbDatabaseDump[] = [
      {
        name: 'evil',
        version: 1,
        stores: [
          {
            name: 's',
            keyPath: null,
            autoIncrement: false,
            indexes: [],
            records: [['k', { $t: 'view', c: 'Function', v: btoa('alert(1)') }]] as [unknown, unknown][],
          },
        ],
      },
    ];
    await writePageStorage({ idb: dump }, { local: false, session: false, idb: true });
    const db = await open('evil', 1, () => undefined);
    const [value] = await getAll(db, 's');
    db.close();
    expect(Object.prototype.toString.call(value)).toBe('[object Uint8Array]');
  });

  it('reports a database another tab keeps open (it could not be replaced)', async () => {
    const held = await open('held', 1, (handle) => handle.createObjectStore('s'));
    // Like a tab of the site in another window: it never closes the database when asked to.
    held.onversionchange = null;
    const result = await writePageStorage({ idb: [] }, { local: false, session: false, idb: true });
    expect(result.idbFailed).toBe(true);
    expect(result.errors.join(' ')).toMatch(/held/);
    held.close();
  }, 10_000);
});

describe('separate tabs (lanes)', () => {
  const LANE = 'lane00000001';
  const OTHER = 'lane00000002';

  it("keeps the browser's own session and each lane's apart", async () => {
    localStorage.setItem('token', 'own');
    localStorage.setItem(`__sdl:${LANE}:token`, 'lane');
    localStorage.setItem(`__sdl:${OTHER}:token`, 'other');

    expect((await readPageStorage({ local: true, session: false, idb: false, idbLimitBytes: 0 })).local).toEqual({
      token: 'own',
    });
    expect(
      (await readPageStorage({ local: true, session: false, idb: false, idbLimitBytes: 0, lane: LANE })).local,
    ).toEqual({ token: 'lane' });

    // A normal switch replaces the browser's own keys and leaves every lane's alone.
    await writePageStorage({ local: { token: 'next' } }, { local: true, session: false, idb: false });
    expect(localStorage.getItem('token')).toBe('next');
    expect(localStorage.getItem(`__sdl:${LANE}:token`)).toBe('lane');
    expect(localStorage.getItem(`__sdl:${OTHER}:token`)).toBe('other');

    // A lane write replaces only that lane's keys.
    await writePageStorage({ local: { a: '1' } }, { local: true, session: false, idb: false, lane: LANE });
    expect(localStorage.getItem(`__sdl:${LANE}:a`)).toBe('1');
    expect(localStorage.getItem(`__sdl:${LANE}:token`)).toBeNull();
    expect(localStorage.getItem('token')).toBe('next');
    expect(localStorage.getItem(`__sdl:${OTHER}:token`)).toBe('other');
  });

  it('scopes databases the same way', async () => {
    const dump: IdbDatabaseDump = {
      name: 'auth',
      version: 1,
      stores: [{ name: 's', keyPath: null, autoIncrement: false, indexes: [], records: [['k', 'lane']] }],
    };
    await writePageStorage({ idb: [dump] }, { local: false, session: false, idb: true, lane: LANE });
    const own = await readPageStorage({ local: false, session: false, idb: true, idbLimitBytes: 1e6 });
    expect(own.idb).toEqual([]);
    const lane = await readPageStorage({ local: false, session: false, idb: true, idbLimitBytes: 1e6, lane: LANE });
    expect(lane.idb?.map((db) => db.name)).toEqual(['auth']);
    expect((await indexedDB.databases()).map((info) => info.name)).toEqual([`__sdl:${LANE}:auth`]);
  });

  it('drops what lanes left behind', async () => {
    localStorage.setItem('own', '1');
    localStorage.setItem(`__sdl:${LANE}:a`, '1');
    localStorage.setItem(`__sdl:${OTHER}:a`, '1');
    expect(await dropLaneData({ keep: [LANE] })).toMatchObject({ keys: 1 });
    expect(localStorage.getItem(`__sdl:${OTHER}:a`)).toBeNull();
    expect(localStorage.getItem(`__sdl:${LANE}:a`)).toBe('1');
    expect(await dropLaneData({ tokens: [LANE] })).toMatchObject({ keys: 1 });
    expect(localStorage.getItem('own')).toBe('1');
    expect(await dropLaneData({ tokens: [LANE], expectedOrigin: 'https://elsewhere.test' })).toMatchObject({ keys: 0 });
  });
});

describe('page UI', () => {
  it('reports where the page is and shows an overlay and a toast', () => {
    expect(probePage()).toMatchObject({ origin: location.origin });
    showOverlay({ title: 'Switching', subtitle: 'Wait', color: '#6d4cff', theme: 'light' });
    expect(document.getElementById('swapdeck-overlay')).not.toBeNull();
    showToast({
      title: 'Now using Work',
      body: 'a@b.co',
      badge: 'WO',
      color: '#6d4cff',
      badgeText: '#ffffff',
      tone: 'success',
      theme: 'dark',
      closeLabel: 'Close',
      durationMs: 10_000,
    });
    showToast({
      title: 'Again',
      body: '',
      badge: 'WO',
      color: '#6d4cff',
      badgeText: '#ffffff',
      tone: 'info',
      theme: 'system',
      closeLabel: 'Close',
      durationMs: 10_000,
    });
    expect(document.querySelectorAll('#swapdeck-toast')).toHaveLength(1);
  });

  it('marks pages of an important account with one strip, and removes it', () => {
    showRibbon({ tag: 'Important', label: 'Prod' });
    showRibbon({ tag: 'Important', label: 'Prod' });
    const ribbon = document.querySelectorAll('#swapdeck-ribbon');
    expect(ribbon).toHaveLength(1);
    expect((ribbon[0] as HTMLElement).style.pointerEvents).toBe('none');
    showRibbon(null);
    expect(document.getElementById('swapdeck-ribbon')).toBeNull();
  });

  it('shows other accounts in a quiet style, never with an unsafe color', () => {
    showRibbon({ tag: 'Client X', label: 'Work', tone: 'calm', color: '#2f4e86' });
    expect((document.getElementById('swapdeck-ribbon') as HTMLElement).dataset.tone).toBe('calm');
    showRibbon({ tag: 'Client X', label: 'Work', tone: 'calm', color: 'red; background: url(x)' });
    expect(document.querySelectorAll('#swapdeck-ribbon')).toHaveLength(1);
    showRibbon({ tag: 'Important', label: 'Prod' });
    expect((document.getElementById('swapdeck-ribbon') as HTMLElement).dataset.tone).toBe('important');
    showRibbon(null);
  });
});
