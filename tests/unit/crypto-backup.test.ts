import { describe, expect, it } from 'vitest';
import { BackupError, openBackup, parseBackupFile, sanitizePayload, serializeBackup } from '../../src/core/backup';
import {
  createVault,
  CryptoError,
  decryptWithPassword,
  encryptWithPassword,
  fromBase64,
  isPasswordBox,
  isSealedBox,
  rekeyVault,
  seal,
  toBase64,
  unlockVault,
  unseal,
} from '../../src/core/crypto';

describe('base64', () => {
  it('round-trips large buffers', () => {
    const bytes = new Uint8Array(200_000).map((_, index) => index % 256);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });
});

describe('vault', () => {
  it('seals with the public key and opens only with the unlocked private key', async () => {
    const { meta, privateKey } = await createVault('correct horse battery');
    const box = await seal({ secret: 'session', n: 1 }, meta.publicKey);
    expect(isSealedBox(box)).toBe(true);
    expect(JSON.stringify(box)).not.toContain('session');
    expect(await unseal(box, privateKey)).toEqual({ secret: 'session', n: 1 });

    expect(await unlockVault(meta, 'correct horse battery')).toBe(privateKey);
    await expect(unlockVault(meta, 'wrong passphrase')).rejects.toBeInstanceOf(CryptoError);
  });

  it('keeps sealed data readable after the passphrase changes', async () => {
    const { meta, privateKey } = await createVault('first passphrase');
    const box = await seal('hello', meta.publicKey);
    const next = await rekeyVault(meta, privateKey, 'second passphrase');
    await expect(unlockVault(next, 'first passphrase')).rejects.toThrow();
    const key = await unlockVault(next, 'second passphrase');
    expect(await unseal(box, key)).toBe('hello');
  });

  it('reports tampered boxes as corrupt', async () => {
    const { meta, privateKey } = await createVault('passphrase 123');
    const box = await seal('x', meta.publicKey);
    await expect(unseal({ ...box, data: toBase64(new Uint8Array(32)) }, privateKey)).rejects.toMatchObject({
      code: 'CORRUPT',
    });
  });
});

describe('password boxes', () => {
  it('encrypts and decrypts, rejecting wrong passwords', async () => {
    const box = await encryptWithPassword('{"a":1}', 'p4ssword!');
    expect(isPasswordBox(box)).toBe(true);
    expect(await decryptWithPassword(box, 'p4ssword!')).toBe('{"a":1}');
    await expect(decryptWithPassword(box, 'nope')).rejects.toMatchObject({ code: 'BAD_PASSPHRASE' });
  });

  it('rejects implausible key derivation settings', () => {
    expect(isPasswordBox({ kdf: 'PBKDF2-SHA-256', iterations: 10, salt: 'a', iv: 'b', data: 'c' })).toBe(false);
  });
});

const payload = {
  apps: [
    {
      id: 'app_1',
      name: 'Acme',
      color: '#123456',
      domains: ['acme.test'],
      origin: 'https://acme.test',
      homeUrl: 'https://acme.test/',
      stagingPath: '/robots.txt',
      storage: { cookies: true, localStorage: true },
      detector: { kind: 'auto' },
      order: 0,
      createdAt: 1,
    },
  ],
  accounts: [
    { id: 'acc_1', appId: 'app_1', label: 'Work', color: '#6d4cff', order: 0, createdAt: 1, switchCount: 0 },
    { id: 'acc_orphan', appId: 'app_missing', label: 'Lost', color: '#6d4cff' },
  ],
  active: { app_1: 'acc_1', app_missing: 'acc_orphan' },
  settings: { language: 'vi' },
  sessions: {
    acc_1: { v: 1, capturedAt: 5, origin: 'https://acme.test', cookies: [], storage: { localStorage: { a: '1' } } },
    acc_orphan: { v: 1, capturedAt: 5, origin: 'x', cookies: [], storage: {} },
  },
};

describe('backups', () => {
  it('drops accounts, sessions and active entries that point nowhere', () => {
    const clean = sanitizePayload(payload);
    expect(clean.accounts.map((account) => account.id)).toEqual(['acc_1']);
    expect(Object.keys(clean.sessions)).toEqual(['acc_1']);
    expect(clean.active).toEqual({ app_1: 'acc_1' });
    expect(clean.settings.language).toBe('vi');
  });

  it('round-trips plain and encrypted files', async () => {
    const plain = parseBackupFile(
      serializeBackup({
        format: 'swapdeck-backup',
        version: 1,
        createdAt: 9,
        encrypted: false,
        payload: sanitizePayload(payload),
      }),
    );
    expect((await openBackup(plain)).accounts).toHaveLength(1);

    const box = await encryptWithPassword(JSON.stringify(payload), 'backup-pass');
    const encrypted = parseBackupFile(
      serializeBackup({ format: 'swapdeck-backup', version: 1, createdAt: 9, encrypted: true, payload: box }),
    );
    await expect(openBackup(encrypted)).rejects.toMatchObject({ code: 'NEEDS_PASSWORD' });
    await expect(openBackup(encrypted, 'wrong')).rejects.toMatchObject({ code: 'BAD_PASSPHRASE' });
    expect((await openBackup(encrypted, 'backup-pass')).sessions.acc_1?.storage.localStorage).toEqual({ a: '1' });
  });

  it('refuses files that are not Swapdeck backups', () => {
    expect(() => parseBackupFile('not json')).toThrow(BackupError);
    expect(() => parseBackupFile('{"format":"other","version":1}')).toThrow(BackupError);
    expect(() => parseBackupFile('{"format":"swapdeck-backup","version":1,"encrypted":true,"payload":{}}')).toThrow(
      BackupError,
    );
  });
});
