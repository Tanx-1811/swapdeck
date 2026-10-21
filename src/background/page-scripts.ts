/*
 * Functions injected into a site's tab with chrome.scripting.executeScript.
 * Chrome serializes each function's source, so every one of them must be
 * self-contained: no imports, no references to anything outside its body.
 * They run in the extension's isolated world, so the page's own scripts
 * can't see or tamper with them. Return values must be JSON-safe.
 */

import type { IdbDatabaseDump } from '../core/types';

export type PageReadOptions = { local: boolean; session: boolean; idb: boolean; idbLimitBytes: number };

export type PageReadResult = {
  origin: string;
  href: string;
  title: string;
  contentType: string;
  local?: Record<string, string>;
  session?: Record<string, string>;
  idb?: IdbDatabaseDump[];
  idbError?: string;
};

/** Reads the page origin's web storage (and IndexedDB when asked). */
export async function readPageStorage(options: PageReadOptions): Promise<PageReadResult> {
  function toBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  }

  // Values are encoded with type tags so dates, binary data, maps and sets survive JSON.
  async function encode(value: unknown): Promise<unknown> {
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : { $t: 'num', v: String(value) };
    if (typeof value === 'undefined') return { $t: 'undef' };
    if (typeof value === 'bigint') return { $t: 'bigint', v: value.toString() };
    if (value instanceof Date) return { $t: 'date', v: value.getTime() };
    if (value instanceof RegExp) return { $t: 're', s: value.source, f: value.flags };
    if (value instanceof ArrayBuffer) return { $t: 'ab', v: toBase64(new Uint8Array(value)) };
    if (ArrayBuffer.isView(value)) {
      const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      return { $t: 'view', c: value.constructor.name, v: toBase64(bytes) };
    }
    if (value instanceof Blob) {
      const bytes = new Uint8Array(await value.arrayBuffer());
      return value instanceof File
        ? { $t: 'file', type: value.type, name: value.name, lm: value.lastModified, v: toBase64(bytes) }
        : { $t: 'blob', type: value.type, v: toBase64(bytes) };
    }
    if (value instanceof Map) {
      const entries: unknown[] = [];
      for (const [key, item] of value) entries.push([await encode(key), await encode(item)]);
      return { $t: 'map', v: entries };
    }
    if (value instanceof Set) {
      const items: unknown[] = [];
      for (const item of value) items.push(await encode(item));
      return { $t: 'set', v: items };
    }
    if (Array.isArray(value)) {
      const items: unknown[] = [];
      for (const item of value) items.push(await encode(item));
      return items;
    }
    if (typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) out[key] = await encode(item);
      return '$t' in out ? { $t: 'obj', v: out } : out;
    }
    return null;
  }

  function request<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function openExisting(name: string): Promise<IDBDatabase | null> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(name);
      let created = false;
      req.onupgradeneeded = () => {
        // The database vanished in the meantime: don't leave an empty one behind.
        created = true;
        req.transaction?.abort();
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => (created ? resolve(null) : reject(req.error));
    });
  }

  async function dumpIndexedDb(limit: number): Promise<IdbDatabaseDump[]> {
    const dumps: IdbDatabaseDump[] = [];
    let total = 0;
    for (const info of await indexedDB.databases()) {
      if (!info.name) continue;
      const db = await openExisting(info.name);
      if (!db) continue;
      try {
        const dump: IdbDatabaseDump = { name: db.name, version: db.version, stores: [] };
        for (const storeName of Array.from(db.objectStoreNames)) {
          // One transaction per store, and encoding only after it is done:
          // awaiting a Blob read inside a transaction would let it commit early.
          const store = db.transaction(storeName, 'readonly').objectStore(storeName);
          const indexes = Array.from(store.indexNames).map((indexName) => {
            const index = store.index(indexName);
            return { name: index.name, keyPath: index.keyPath, unique: index.unique, multiEntry: index.multiEntry };
          });
          const [keys, values] = await Promise.all([request(store.getAllKeys()), request(store.getAll())]);
          const records: [unknown, unknown][] = [];
          for (let i = 0; i < values.length; i++) {
            const encoded = await encode(values[i]);
            total += JSON.stringify(encoded)?.length ?? 0;
            if (total > limit) throw new Error(`IndexedDB is larger than ${Math.round(limit / 1e6)} MB`);
            records.push([store.keyPath === null ? await encode(keys[i]) : null, encoded]);
          }
          dump.stores.push({
            name: store.name,
            keyPath: store.keyPath as string | string[] | null,
            autoIncrement: store.autoIncrement,
            indexes,
            records,
          });
        }
        dumps.push(dump);
      } finally {
        db.close();
      }
    }
    return dumps;
  }

  function readWebStorage(storage: Storage): Record<string, string> {
    const out: Record<string, string> = {};
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key !== null) out[key] = storage.getItem(key) ?? '';
    }
    return out;
  }

  const result: PageReadResult = {
    origin: location.origin,
    href: location.href,
    title: document.title,
    contentType: document.contentType,
  };
  if (options.local) result.local = readWebStorage(localStorage);
  if (options.session) result.session = readWebStorage(sessionStorage);
  if (options.idb) {
    try {
      result.idb = await dumpIndexedDb(options.idbLimitBytes);
    } catch (error) {
      result.idbError = error instanceof Error ? error.message : String(error);
    }
  }
  return result;
}

export type PageWriteData = {
  local?: Record<string, string> | null;
  session?: Record<string, string> | null;
  idb?: IdbDatabaseDump[] | null;
};
export type PageWriteOptions = { local: boolean; session: boolean; idb: boolean };
export type PageWriteResult = { origin: string; errors: string[] };

/** Replaces the page origin's web storage (and IndexedDB when asked) with saved data. */
export async function writePageStorage(data: PageWriteData, options: PageWriteOptions): Promise<PageWriteResult> {
  const errors: string[] = [];
  // Only these constructors may be rebuilt from saved data.
  const VIEWS: Record<string, new (buffer: ArrayBuffer) => ArrayBufferView> = {
    Int8Array,
    Uint8Array,
    Uint8ClampedArray,
    Int16Array,
    Uint16Array,
    Int32Array,
    Uint32Array,
    Float32Array,
    Float64Array,
    BigInt64Array,
    BigUint64Array,
    DataView,
  };

  function fromBase64(text: string): Uint8Array<ArrayBuffer> {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function decodeEntries(value: object): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = decode(item);
    return out;
  }

  function decode(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(decode);
    if (!value || typeof value !== 'object') return value;
    const tagged = value as Record<string, unknown> & { $t?: string };
    const text = (key: string) => String(tagged[key] ?? '');
    switch (tagged.$t) {
      case undefined:
        return decodeEntries(tagged);
      case 'obj':
        // A plain object that itself had a "$t" key.
        return decodeEntries((tagged.v as object) ?? {});
      case 'num':
        return Number(text('v'));
      case 'undef':
        return undefined;
      case 'bigint':
        return BigInt(text('v'));
      case 'date':
        return new Date(Number(tagged.v));
      case 're':
        return new RegExp(text('s'), text('f'));
      case 'ab':
        return fromBase64(text('v')).buffer;
      case 'view': {
        const View = VIEWS[text('c')];
        const bytes = fromBase64(text('v'));
        return View ? new View(bytes.buffer) : bytes;
      }
      case 'blob':
        return new Blob([fromBase64(text('v'))], { type: text('type') });
      case 'file':
        return new File([fromBase64(text('v'))], text('name'), { type: text('type'), lastModified: Number(tagged.lm) });
      case 'map':
        return new Map(((tagged.v as unknown[][]) ?? []).map(([key, item]) => [decode(key), decode(item)]));
      case 'set':
        return new Set(((tagged.v as unknown[]) ?? []).map(decode));
      default:
        return null;
    }
  }

  function settle(req: IDBRequest | IDBOpenDBRequest, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      req.onsuccess = done;
      req.onerror = done;
    });
  }

  async function restoreIndexedDb(dumps: IdbDatabaseDump[]) {
    for (const info of await indexedDB.databases()) {
      if (info.name) await settle(indexedDB.deleteDatabase(info.name), 5000);
    }
    for (const dump of dumps) {
      await new Promise<void>((resolve) => {
        const req = indexedDB.open(dump.name, Math.max(1, Math.floor(dump.version) || 1));
        req.onupgradeneeded = () => {
          const db = req.result;
          for (const store of dump.stores) {
            try {
              const objectStore = db.createObjectStore(store.name, {
                keyPath: store.keyPath === null ? undefined : store.keyPath,
                autoIncrement: store.autoIncrement,
              });
              for (const index of store.indexes) {
                objectStore.createIndex(index.name, index.keyPath, {
                  unique: index.unique,
                  multiEntry: index.multiEntry,
                });
              }
              for (const [key, value] of store.records) {
                const put =
                  store.keyPath === null
                    ? objectStore.put(decode(value), decode(key) as IDBValidKey)
                    : objectStore.put(decode(value));
                // A single bad record must not abort the whole database.
                put.onerror = (event) => {
                  event.preventDefault();
                  errors.push(`IndexedDB ${dump.name}/${store.name}: ${put.error?.message ?? 'write failed'}`);
                };
              }
            } catch (error) {
              errors.push(`IndexedDB ${dump.name}/${store.name}: ${error instanceof Error ? error.message : error}`);
            }
          }
        };
        req.onsuccess = () => {
          req.result.close();
          resolve();
        };
        req.onerror = () => {
          errors.push(`IndexedDB ${dump.name}: ${req.error?.message ?? 'open failed'}`);
          resolve();
        };
      });
    }
  }

  function replace(storage: Storage, values: Record<string, string> | null | undefined, label: string) {
    try {
      storage.clear();
    } catch (error) {
      errors.push(`${label}: ${error instanceof Error ? error.message : error}`);
      return;
    }
    for (const [key, value] of Object.entries(values ?? {})) {
      try {
        storage.setItem(key, value);
      } catch (error) {
        errors.push(`${label} ${key}: ${error instanceof Error ? error.message : error}`);
      }
    }
  }

  if (options.local) replace(localStorage, data.local, 'localStorage');
  if (options.session) replace(sessionStorage, data.session, 'sessionStorage');
  if (options.idb) {
    try {
      await restoreIndexedDb(data.idb ?? []);
    } catch (error) {
      errors.push(`IndexedDB: ${error instanceof Error ? error.message : error}`);
    }
  }
  return { origin: location.origin, errors };
}

/** Where the staging page really is (redirects may have moved it). */
export function probePage(): { origin: string; href: string; contentType: string } {
  return { origin: location.origin, href: location.href, contentType: document.contentType };
}

export type OverlayText = { title: string; subtitle: string; color: string; theme: 'system' | 'light' | 'dark' };

/** Covers the plain staging page with a "switching…" screen while the swap runs. */
export function showOverlay(text: OverlayText): void {
  const id = 'swapdeck-overlay';
  document.getElementById(id)?.remove();
  const host = document.createElement('div');
  host.id = id;
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'closed' });
  const sheet = new CSSStyleSheet();
  const dark =
    text.theme === 'dark' ||
    (text.theme === 'system' && typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches);
  const bg = dark ? '#141110' : '#f4f0e8';
  const fg = dark ? '#f1e9dc' : '#1a1714';
  const muted = dark ? '#c2b6a5' : '#57504a';
  const paper = dark ? '#1c1816' : '#fbf9f5';
  const line = dark ? '#4a3f36' : '#cbbfab';
  // A small deck: the account's card lifts off the pile while the swap runs.
  sheet.replaceSync(`
    .wrap { position: fixed; inset: 0; display: grid; place-items: center; background: ${bg}; color: ${fg};
      font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    .card { display: grid; justify-items: center; gap: 14px; text-align: center; padding: 24px; }
    .deck { position: relative; width: 56px; height: 42px; margin-bottom: 6px; }
    .deck i { position: absolute; inset: 0; border-radius: 8px; border: 1px solid ${line}; background: ${paper}; }
    .deck i:first-child { transform: rotate(-9deg) translate(-5px, 3px); }
    .deck i:last-child { border-color: transparent; background: ${text.color};
      box-shadow: 0 8px 18px -6px rgba(26, 23, 20, .45); animation: lift 1.1s cubic-bezier(.2, .7, .2, 1) infinite alternate; }
    .title { font: 600 19px/1.3 ui-serif, "Iowan Old Style", "Palatino Linotype", Georgia, serif; margin: 0; }
    .sub { color: ${muted}; margin: 0; max-width: 420px; }
    @keyframes lift { from { transform: rotate(2deg); } to { transform: translate(10px, -9px) rotate(8deg); } }
    @media (prefers-reduced-motion: reduce) { .deck i:last-child { animation-duration: 3s; } }
  `);
  root.adoptedStyleSheets = [sheet];
  const wrap = document.createElement('div');
  wrap.className = 'wrap';
  wrap.setAttribute('role', 'status');
  const card = document.createElement('div');
  card.className = 'card';
  const ring = document.createElement('div');
  ring.className = 'deck';
  ring.append(document.createElement('i'), document.createElement('i'));
  const title = document.createElement('p');
  title.className = 'title';
  title.textContent = text.title;
  const sub = document.createElement('p');
  sub.className = 'sub';
  sub.textContent = text.subtitle;
  card.append(ring, title, sub);
  wrap.append(card);
  root.append(wrap);
  (document.body ?? document.documentElement).append(host);
}

export type ToastContent = {
  title: string;
  body: string;
  badge: string;
  color: string;
  /** Text color on the badge, chosen for contrast. */
  badgeText: string;
  tone: 'success' | 'warning' | 'info';
  theme: 'system' | 'light' | 'dark';
  closeLabel: string;
  durationMs: number;
};

/** A small confirmation in the page's corner, e.g. "Now using Work". */
export function showToast(content: ToastContent): void {
  const id = 'swapdeck-toast';
  document.getElementById(id)?.remove();
  const host = document.createElement('div');
  host.id = id;
  host.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'closed' });
  const sheet = new CSSStyleSheet();
  const dark =
    content.theme === 'dark' ||
    (content.theme === 'system' &&
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-color-scheme: dark)').matches);
  const bg = dark ? '#1c1816' : '#fbf9f5';
  const fg = dark ? '#f1e9dc' : '#1a1714';
  const muted = dark ? '#c2b6a5' : '#57504a';
  const border = dark ? '#332b25' : '#e1d9cb';
  const hover = dark ? '#262019' : '#eee8de';
  const tones = dark
    ? { warning: '#e3a957', info: '#93b1e8', success: '#6fc39e' }
    : { warning: '#8f5a12', info: '#2f4e86', success: '#1f6b52' };
  const accent = tones[content.tone];
  sheet.replaceSync(`
    .toast { display: flex; align-items: center; gap: 12px; min-width: 260px; max-width: 380px; padding: 12px 10px 12px 13px;
      background: ${bg}; color: ${fg}; border: 1px solid ${border}; border-left: 3px solid ${accent}; border-radius: 10px;
      box-shadow: 0 1px 2px rgba(26, 23, 20, .08), 0 16px 36px -12px rgba(26, 23, 20, .4);
      font: 13px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; animation: in .22s cubic-bezier(.2, .7, .2, 1); }
    .badge { flex: none; width: 34px; height: 34px; border-radius: 9px; display: grid; place-items: center;
      background: ${content.color}; color: ${content.badgeText}; font-weight: 700; font-size: 12.5px; letter-spacing: .03em;
      box-shadow: inset 0 0 0 1px rgba(26, 23, 20, .1); }
    .text { flex: 1; min-width: 0; }
    .title { margin: 0; font-weight: 600; font-size: 13.5px; }
    .body { margin: 2px 0 0; color: ${muted}; overflow-wrap: anywhere; }
    .brand { margin: 0 0 2px; font-size: 10px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: ${muted}; }
    button { flex: none; width: 26px; height: 26px; border: 0; border-radius: 6px; background: transparent; color: ${muted};
      font-size: 18px; line-height: 1; cursor: pointer; }
    button:hover { background: ${hover}; color: ${fg}; }
    button:focus-visible { outline: 2px solid ${accent}; outline-offset: 1px; }
    @keyframes in { from { opacity: 0; transform: translateY(-6px); } }
    @media (prefers-reduced-motion: reduce) { .toast { animation: none; } }
  `);
  root.adoptedStyleSheets = [sheet];
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'status');
  const badge = document.createElement('div');
  badge.className = 'badge';
  badge.textContent = content.badge;
  badge.setAttribute('aria-hidden', 'true');
  const text = document.createElement('div');
  text.className = 'text';
  const brand = document.createElement('p');
  brand.className = 'brand';
  brand.textContent = 'Swapdeck';
  const title = document.createElement('p');
  title.className = 'title';
  title.textContent = content.title;
  const body = document.createElement('p');
  body.className = 'body';
  body.textContent = content.body;
  text.append(brand, title);
  if (content.body) text.append(body);
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.setAttribute('aria-label', content.closeLabel);
  close.addEventListener('click', () => host.remove());
  toast.append(badge, text, close);
  root.append(toast);
  (document.body ?? document.documentElement).append(host);
  setTimeout(() => host.remove(), content.durationMs);
}

export type RibbonContent = { tag: string; label: string };

/**
 * A red strip along the top of the page, with a small tag, while an important
 * account is in use. It never takes clicks. `null` removes it.
 */
export function showRibbon(content: RibbonContent | null): void {
  const id = 'swapdeck-ribbon';
  document.getElementById(id)?.remove();
  if (!content) return;
  const host = document.createElement('div');
  host.id = id;
  host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483646;pointer-events:none;';
  const root = host.attachShadow({ mode: 'closed' });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`
    .bar { position: fixed; top: 0; left: 0; right: 0; height: 3px; background: #b3261e; pointer-events: none; }
    .tag { position: fixed; top: 0; left: 50%; transform: translateX(-50%); max-width: 60vw; padding: 1px 10px 3px;
      border-radius: 0 0 7px 7px; background: #b3261e; color: #fff; pointer-events: none; white-space: nowrap;
      overflow: hidden; text-overflow: ellipsis; box-shadow: 0 2px 8px rgba(26, 23, 20, .28);
      font: 600 11px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    .tag b { font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
  `);
  root.adoptedStyleSheets = [sheet];
  const bar = document.createElement('div');
  bar.className = 'bar';
  const tag = document.createElement('div');
  tag.className = 'tag';
  tag.setAttribute('role', 'note');
  const strong = document.createElement('b');
  strong.textContent = content.tag;
  tag.append(strong, ` · ${content.label}`);
  root.append(bar, tag);
  document.documentElement.append(host);
}
