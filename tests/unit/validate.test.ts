import { describe, expect, it } from 'vitest';
import {
  sanitizeAccount,
  sanitizeActive,
  sanitizeApp,
  sanitizeCookie,
  sanitizeDetector,
  sanitizeHistory,
  sanitizeSnapshot,
  sanitizeStoredSnapshot,
  sanitizeVault,
} from '../../src/core/validate';

describe('sanitizeApp', () => {
  const valid = {
    id: 'app_1',
    name: '  Acme  ',
    color: '#ABCDEF',
    domains: ['https://Acme.test/x', 'acme.test', 'not a domain'],
    origin: 'https://app.acme.test/some/path',
    homeUrl: 'javascript:alert(1)',
    stagingPath: 'robots.txt',
    storage: { cookies: false, indexedDB: true },
    detector: { kind: 'cookie', names: ['sid'], format: 'weird' },
    recentPattern: '([',
    order: 2,
    createdAt: 1,
    unknown: 'dropped',
  };

  it('keeps only valid, normalised fields', () => {
    const app = sanitizeApp(valid)!;
    expect(app).toMatchObject({
      id: 'app_1',
      name: 'Acme',
      color: '#abcdef',
      domains: ['acme.test'],
      origin: 'https://app.acme.test',
      homeUrl: 'https://app.acme.test/',
      stagingPath: '/robots.txt',
      storage: { cookies: false, localStorage: true, sessionStorage: false, indexedDB: true },
      detector: { kind: 'cookie', names: ['sid'], format: 'plain' },
    });
    expect(app).not.toHaveProperty('recentPattern');
    expect(app).not.toHaveProperty('unknown');
  });

  it('rejects apps without id, name, domain or origin', () => {
    expect(sanitizeApp({ ...valid, id: 'bad id!' })).toBeNull();
    expect(sanitizeApp({ ...valid, name: '' })).toBeNull();
    expect(sanitizeApp({ ...valid, domains: [] })).toBeNull();
    expect(sanitizeApp({ ...valid, origin: 'ftp://x' })).toBeNull();
    expect(sanitizeApp('nope')).toBeNull();
  });

  it('defaults unknown detectors to automatic', () => {
    expect(sanitizeDetector({ kind: 'localStorage', keys: [] })).toEqual({ kind: 'auto' });
    expect(sanitizeDetector({ kind: 'none' })).toEqual({ kind: 'none' });
    expect(sanitizeDetector({ kind: 'localStorage', keys: ['k'], fields: { email: ['a.b'], id: 'x' } })).toEqual({
      kind: 'localStorage',
      keys: ['k'],
      fields: { email: ['a.b'] },
    });
  });
});

describe('sanitizeAccount', () => {
  it('drops unsafe URLs and keeps known optional fields', () => {
    const account = sanitizeAccount({
      id: 'acc_1',
      appId: 'app_1',
      label: 'Work',
      color: 'red',
      emoji: '💼',
      avatarUrl: 'http://insecure.example/a.png',
      homeUrl: 'https://acme.test/home',
      lastUrl: 'data:text/html,hi',
      pins: [
        { id: 'p', url: 'https://acme.test/p', title: 'P' },
        { id: 'q', url: 'javascript:x' },
      ],
      recents: [{ key: 'k', url: 'https://acme.test/k' }],
      stats: { cookies: 3, storageKeys: 'x' },
    })!;
    expect(account.color).toBe('#c8402b');
    expect(account.emoji).toBe('💼');
    expect(account).not.toHaveProperty('important');
    expect(sanitizeAccount({ id: 'a', appId: 'b', label: 'L', important: true })!.important).toBe(true);
    expect(sanitizeAccount({ id: 'a', appId: 'b', label: 'L', important: 'yes' })).not.toHaveProperty('important');
    expect(account).not.toHaveProperty('avatarUrl');
    expect(account).not.toHaveProperty('lastUrl');
    expect(account.homeUrl).toBe('https://acme.test/home');
    expect(account.pins).toHaveLength(1);
    expect(account.recents[0]).toMatchObject({ key: 'k', title: 'k', at: 0 });
    expect(account.stats).toEqual({ cookies: 3, storageKeys: 0, databases: 0, bytes: 0 });
  });
});

describe('snapshots and the rest', () => {
  it('cleans cookies and snapshots', () => {
    expect(
      sanitizeCookie({ name: 'a', value: 'b', domain: 'x.co', sameSite: 'bogus', session: true, expirationDate: 5 }),
    ).toEqual({
      name: 'a',
      value: 'b',
      domain: 'x.co',
      path: '/',
      secure: false,
      httpOnly: false,
      hostOnly: false,
      session: true,
      sameSite: 'unspecified',
    });
    const snapshot = sanitizeSnapshot({
      v: 1,
      capturedAt: 3,
      origin: 'https://x.co',
      cookies: [{ name: 'a', value: 'b', domain: 'x.co' }, 'junk'],
      storage: { localStorage: { a: '1', b: 2 }, indexedDB: [{ name: 'db', version: 1, stores: [] }, { name: 1 }] },
      identity: { email: 'a@b.co', confidence: 'weird' },
    })!;
    expect(snapshot.cookies).toHaveLength(1);
    expect(snapshot.storage.localStorage).toEqual({ a: '1' });
    expect(snapshot.storage.indexedDB).toHaveLength(1);
    expect(snapshot.identity).toEqual({ email: 'a@b.co', confidence: 'strong', source: '' });
    expect(sanitizeSnapshot({ v: 2 })).toBeNull();
  });

  it('accepts plain or sealed stored snapshots only', () => {
    expect(
      sanitizeStoredSnapshot({ v: 1, sealed: { alg: 'RSA-OAEP-256+A256GCM', key: 'k', iv: 'i', data: 'd' } }),
    ).toEqual({
      v: 1,
      sealed: { alg: 'RSA-OAEP-256+A256GCM', key: 'k', iv: 'i', data: 'd' },
    });
    expect(sanitizeStoredSnapshot({ v: 1, sealed: { alg: 'none' } })).toBeNull();
    expect(sanitizeStoredSnapshot({ v: 1, plain: { v: 1, origin: 'o', cookies: [], storage: {} } })).not.toBeNull();
  });

  it('cleans history, vault and active maps', () => {
    expect(
      sanitizeHistory({
        id: 'h',
        at: 1,
        appId: 'a',
        kind: 'switch',
        fromId: null,
        toId: 'x',
        ok: false,
        error: 'TIMEOUT',
      }),
    ).toEqual({
      id: 'h',
      at: 1,
      appId: 'a',
      appName: '',
      kind: 'switch',
      fromId: null,
      toId: 'x',
      ok: false,
      error: 'TIMEOUT',
    });
    expect(sanitizeHistory({ id: 'h', at: 1, appId: 'a', kind: 'explode' })).toBeNull();
    expect(
      sanitizeVault({ v: 1, salt: 's', iterations: 1000, publicKey: 'p', privateKey: { iv: 'i', data: 'd' } }),
    ).toBeNull();
    expect(sanitizeActive({ a: 'acc_1', b: null, c: 5, d: 'bad id!' })).toEqual({ a: 'acc_1', b: null });
  });
});
