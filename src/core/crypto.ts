import type { SealedBox, VaultMeta } from './types';

/**
 * Vault crypto (Web Crypto only):
 * - The passphrase derives a key (PBKDF2-SHA-256) that encrypts an RSA-OAEP private key.
 * - Sessions are sealed with the public key (a fresh AES-256-GCM key per snapshot,
 *   wrapped with RSA-OAEP), so saving works while the vault is locked;
 *   restoring a session needs the private key, i.e. the passphrase.
 * Backups use a separate password with PBKDF2 + AES-256-GCM.
 */

export const PBKDF2_ITERATIONS = 310_000;
const subtle = () => globalThis.crypto.subtle;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class CryptoError extends Error {
  readonly code: 'BAD_PASSPHRASE' | 'CORRUPT';
  constructor(code: 'BAD_PASSPHRASE' | 'CORRUPT') {
    super(code);
    this.code = code;
  }
}

export function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < view.length; i += 0x8000) {
    binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const material = await subtle().importKey('raw', encoder.encode(password.normalize('NFC')), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return subtle().deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

const RSA_PARAMS: RsaHashedKeyGenParams = {
  name: 'RSA-OAEP',
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: 'SHA-256',
};

/** Creates a vault. Returns its metadata and the unlocked private key (PKCS#8, base64). */
export async function createVault(passphrase: string): Promise<{ meta: VaultMeta; privateKey: string }> {
  const salt = randomBytes(16);
  const kek = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);
  const pair = await subtle().generateKey(RSA_PARAMS, true, ['encrypt', 'decrypt']);
  const spki = await subtle().exportKey('spki', pair.publicKey);
  const pkcs8 = await subtle().exportKey('pkcs8', pair.privateKey);
  const iv = randomBytes(12);
  const encrypted = await subtle().encrypt({ name: 'AES-GCM', iv }, kek, pkcs8);
  return {
    meta: {
      v: 1,
      salt: toBase64(salt),
      iterations: PBKDF2_ITERATIONS,
      publicKey: toBase64(spki),
      privateKey: { iv: toBase64(iv), data: toBase64(encrypted) },
      createdAt: Date.now(),
    },
    privateKey: toBase64(pkcs8),
  };
}

/** Decrypts the vault's private key; throws BAD_PASSPHRASE when the passphrase is wrong. */
export async function unlockVault(meta: VaultMeta, passphrase: string): Promise<string> {
  const kek = await deriveKey(passphrase, fromBase64(meta.salt), meta.iterations);
  try {
    const pkcs8 = await subtle().decrypt(
      { name: 'AES-GCM', iv: fromBase64(meta.privateKey.iv) },
      kek,
      fromBase64(meta.privateKey.data),
    );
    return toBase64(pkcs8);
  } catch {
    throw new CryptoError('BAD_PASSPHRASE');
  }
}

/** Re-encrypts the private key under a new passphrase (sealed sessions stay valid). */
export async function rekeyVault(meta: VaultMeta, privateKey: string, passphrase: string): Promise<VaultMeta> {
  const salt = randomBytes(16);
  const kek = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);
  const iv = randomBytes(12);
  const encrypted = await subtle().encrypt({ name: 'AES-GCM', iv }, kek, fromBase64(privateKey));
  return {
    ...meta,
    salt: toBase64(salt),
    iterations: PBKDF2_ITERATIONS,
    privateKey: { iv: toBase64(iv), data: toBase64(encrypted) },
  };
}

export async function seal(value: unknown, publicKey: string): Promise<SealedBox> {
  const key = await subtle().importKey('spki', fromBase64(publicKey), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, [
    'encrypt',
  ]);
  const content = await subtle().generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const iv = randomBytes(12);
  const data = await subtle().encrypt({ name: 'AES-GCM', iv }, content, encoder.encode(JSON.stringify(value)));
  const raw = await subtle().exportKey('raw', content);
  const wrapped = await subtle().encrypt({ name: 'RSA-OAEP' }, key, raw);
  return { alg: 'RSA-OAEP-256+A256GCM', key: toBase64(wrapped), iv: toBase64(iv), data: toBase64(data) };
}

export async function unseal<T>(box: SealedBox, privateKey: string): Promise<T> {
  try {
    const key = await subtle().importKey(
      'pkcs8',
      fromBase64(privateKey),
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['decrypt'],
    );
    const raw = await subtle().decrypt({ name: 'RSA-OAEP' }, key, fromBase64(box.key));
    const content = await subtle().importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
    const data = await subtle().decrypt({ name: 'AES-GCM', iv: fromBase64(box.iv) }, content, fromBase64(box.data));
    return JSON.parse(decoder.decode(data)) as T;
  } catch {
    throw new CryptoError('CORRUPT');
  }
}

/** A password-encrypted payload, as stored in backup files. */
export type PasswordBox = { kdf: 'PBKDF2-SHA-256'; iterations: number; salt: string; iv: string; data: string };

export async function encryptWithPassword(text: string, password: string): Promise<PasswordBox> {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  const iv = randomBytes(12);
  const data = await subtle().encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(text));
  return {
    kdf: 'PBKDF2-SHA-256',
    iterations: PBKDF2_ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    data: toBase64(data),
  };
}

export async function decryptWithPassword(box: PasswordBox, password: string): Promise<string> {
  const key = await deriveKey(password, fromBase64(box.salt), box.iterations);
  try {
    const data = await subtle().decrypt({ name: 'AES-GCM', iv: fromBase64(box.iv) }, key, fromBase64(box.data));
    return decoder.decode(data);
  } catch {
    throw new CryptoError('BAD_PASSPHRASE');
  }
}

export function isPasswordBox(value: unknown): value is PasswordBox {
  if (!value || typeof value !== 'object') return false;
  const box = value as Record<string, unknown>;
  return (
    box.kdf === 'PBKDF2-SHA-256' &&
    typeof box.iterations === 'number' &&
    box.iterations >= 100_000 &&
    box.iterations <= 10_000_000 &&
    typeof box.salt === 'string' &&
    typeof box.iv === 'string' &&
    typeof box.data === 'string'
  );
}

export function isSealedBox(value: unknown): value is SealedBox {
  if (!value || typeof value !== 'object') return false;
  const box = value as Record<string, unknown>;
  return (
    box.alg === 'RSA-OAEP-256+A256GCM' &&
    typeof box.key === 'string' &&
    typeof box.iv === 'string' &&
    typeof box.data === 'string'
  );
}
