/**
 * Runs in the page's own world at document_start on the sites of apps while separate tabs are
 * open (registered by background/lanes.ts). In a separate tab — the document says so through the
 * Server-Timing entry the lane's rules add (core/lanes.ts) — it gives the page its lane's view:
 *
 * - `document.cookie` reads the lane's cookies and writes them through the extension (the browser's
 *   cookie store never sees them); requests wait for pending writes, so the next request carries them;
 * - `localStorage`, IndexedDB names, BroadcastChannel names and Web Locks live under `__sdl:<token>:`;
 * - `cookieStore` is hidden and service workers can't be registered (their requests aren't the tab's).
 *
 * In other tabs it only hides the lanes' localStorage keys from the page, when there are any.
 * It must not throw, and it never sends anything anywhere but to the extension's relay
 * (content/lane-relay.ts) through DOM events on this document.
 */
import { LANE_PREFIX, LANE_TIMING, laneNamespace, parseLaneTiming, pathMatches } from '../core/lanes';

type LaneView = { token: string; cookies: string };

const STATE = Symbol.for('swapdeck.lane');
const TO_RELAY = 'swapdeck-lane';
const FROM_RELAY = 'swapdeck-lane-ack';

(() => {
  const win = window as unknown as Record<symbol, LaneView | undefined>;
  if (win[STATE] !== undefined) return;

  function findLane(): LaneView | null {
    try {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      const entry = nav?.serverTiming?.find((item) => item.name === LANE_TIMING);
      if (entry) return parseLaneTiming(entry.description);
    } catch {
      // No timing here.
    }
    // about:blank and srcdoc frames have no response of their own: they belong to their parent's lane.
    try {
      if (window.parent !== window) {
        const parent = (window.parent as unknown as Record<symbol, LaneView | undefined>)[STATE];
        if (parent) return parent;
      }
    } catch {
      // A cross-origin parent.
    }
    return null;
  }

  const lane = findLane();
  Object.defineProperty(window, STATE, { value: lane ?? undefined, configurable: false, enumerable: false });

  const realLocal = (() => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  })();

  // --- Web storage -------------------------------------------------------------

  function hasLaneKeys(storage: Storage): boolean {
    for (let i = 0; i < storage.length; i++) if (storage.key(i)?.startsWith(LANE_PREFIX)) return true;
    return false;
  }

  /** A Storage that shows the page only its own keys: the lane's (prefix stripped), or everything but the lanes'. */
  function scopedStorage(real: Storage, prefix: string | null): Storage {
    const stored = (key: string) => (prefix ? prefix + key : key);
    const shown = (raw: string): string | null =>
      prefix ? (raw.startsWith(prefix) ? raw.slice(prefix.length) : null) : raw.startsWith(LANE_PREFIX) ? null : raw;
    const keys = (): string[] => {
      const out: string[] = [];
      for (let i = 0; i < real.length; i++) {
        const raw = real.key(i);
        const key = raw === null ? null : shown(raw);
        if (key !== null) out.push(key);
      }
      return out;
    };
    const api: Record<string, unknown> = {
      getItem: (key: unknown) => real.getItem(stored(String(key))),
      setItem: (key: unknown, value: unknown) => real.setItem(stored(String(key)), String(value)),
      removeItem: (key: unknown) => real.removeItem(stored(String(key))),
      clear: () => {
        for (const key of keys()) real.removeItem(stored(key));
      },
      key: (index: unknown) => keys()[Number(index)] ?? null,
    };
    const target = Object.create(Storage.prototype) as Storage;
    return new Proxy(target, {
      get(_target, prop) {
        if (prop === 'length') return keys().length;
        if (typeof prop === 'string' && Object.prototype.hasOwnProperty.call(api, prop)) return api[prop];
        if (typeof prop === 'string') {
          const value = real.getItem(stored(prop));
          if (value !== null) return value;
        }
        // Everything else a Storage has (constructor, hasOwnProperty, toString, Symbol.toStringTag…).
        return Reflect.get(Storage.prototype, prop);
      },
      set(_target, prop, value) {
        if (typeof prop !== 'string') return false;
        real.setItem(stored(prop), String(value));
        return true;
      },
      has(_target, prop) {
        if (typeof prop === 'string' && (prop in api || real.getItem(stored(prop)) !== null)) return true;
        return prop in Storage.prototype;
      },
      deleteProperty(_target, prop) {
        if (typeof prop === 'string') real.removeItem(stored(prop));
        return true;
      },
      ownKeys() {
        return keys();
      },
      getOwnPropertyDescriptor(_target, prop) {
        if (typeof prop !== 'string') return undefined;
        const value = real.getItem(stored(prop));
        return value === null ? undefined : { value, writable: true, enumerable: true, configurable: true };
      },
    });
  }

  function installStorage(prefix: string | null): void {
    if (!realLocal) return;
    const view = scopedStorage(realLocal, prefix);
    try {
      Object.defineProperty(window, 'localStorage', { configurable: true, enumerable: true, get: () => view });
    } catch {
      return;
    }
    // Other tabs' changes arrive as "storage" events: pass on only this view's, under its names.
    const synthetic = new WeakSet<Event>();
    window.addEventListener(
      'storage',
      (event) => {
        if (synthetic.has(event) || event.storageArea !== realLocal) return;
        event.stopImmediatePropagation();
        let key: string | null = null;
        if (event.key !== null) {
          key = prefix
            ? event.key.startsWith(prefix)
              ? event.key.slice(prefix.length)
              : null
            : event.key.startsWith(LANE_PREFIX)
              ? null
              : event.key;
          if (key === null) return;
        }
        const copy = new StorageEvent('storage', {
          key,
          oldValue: event.oldValue,
          newValue: event.newValue,
          url: event.url,
        });
        Object.defineProperty(copy, 'storageArea', { value: view });
        synthetic.add(copy);
        window.dispatchEvent(copy);
      },
      true,
    );
  }

  if (!lane) {
    // Not a separate tab: only keep the lanes' keys out of the page's sight (and out of its clear()).
    if (realLocal && hasLaneKeys(realLocal)) installStorage(null);
    return;
  }

  const ns = laneNamespace(lane.token);
  installStorage(ns);

  // --- Messages to the relay ---------------------------------------------------

  let nextId = 0;
  const waiting = new Map<number, () => void>();
  document.addEventListener(FROM_RELAY, (event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (typeof detail !== 'string') return;
    try {
      const { id, cookies } = JSON.parse(detail) as { id?: unknown; cookies?: unknown };
      // What document.cookie reads now in the lane (cookies the site's responses set included).
      if (typeof cookies === 'string' && !pendingCount) readJar(cookies);
      if (typeof id === 'number') {
        waiting.get(id)?.();
        waiting.delete(id);
      }
    } catch {
      // Not ours.
    }
  });
  /** Sends to the extension; resolves when it has acted, or after a short while regardless. */
  function tell(kind: string, extra: Record<string, unknown> = {}, timeoutMs = 1500): Promise<void> {
    const id = ++nextId;
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        waiting.delete(id);
        resolve();
      }, timeoutMs);
      waiting.set(id, () => {
        clearTimeout(timer);
        resolve();
      });
      document.dispatchEvent(new CustomEvent(TO_RELAY, { detail: JSON.stringify({ kind, id, ...extra }) }));
    });
  }

  // --- document.cookie ---------------------------------------------------------

  const jar = new Map<string, string>();
  function readJar(text: string): void {
    jar.clear();
    for (const part of text ? text.split('; ') : []) {
      const eq = part.indexOf('=');
      if (eq === -1) jar.set('', part);
      else jar.set(part.slice(0, eq), part.slice(eq + 1));
    }
  }
  readJar(lane.cookies);
  let pending: Promise<void> = Promise.resolve();
  let pendingCount = 0;

  const cookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
  try {
    Object.defineProperty(Document.prototype, 'cookie', {
      configurable: true,
      enumerable: true,
      get(this: Document) {
        if (this !== document) return cookieDescriptor?.get?.call(this) ?? '';
        return [...jar].map(([name, value]) => (name ? `${name}=${value}` : value)).join('; ');
      },
      set(this: Document, input: unknown) {
        if (this !== document) {
          cookieDescriptor?.set?.call(this, input);
          return;
        }
        const line = String(input);
        const [pair = '', ...attributes] = line.split(';');
        const eq = pair.indexOf('=');
        const name = (eq === -1 ? '' : pair.slice(0, eq)).trim();
        const value = (eq === -1 ? pair : pair.slice(eq + 1)).trim();
        let removed = false;
        let applies = true;
        for (const attribute of attributes) {
          const [rawKey = '', ...rest] = attribute.split('=');
          const key = rawKey.trim().toLowerCase();
          const attributeValue = rest.join('=').trim();
          if (key === 'httponly') return;
          if (key === 'max-age' && /^-?\d+$/.test(attributeValue) && Number(attributeValue) <= 0) removed = true;
          if (key === 'expires') {
            const at = Date.parse(attributeValue);
            if (Number.isFinite(at) && at <= Date.now()) removed = true;
          }
          if (key === 'path' && attributeValue.startsWith('/') && !pathMatches(location.pathname, attributeValue))
            applies = false;
        }
        if (!name && !value) return;
        if (applies) {
          if (removed) jar.delete(name);
          else jar.set(name, value);
        }
        pendingCount++;
        const sent = tell('cookie', { line }).finally(() => pendingCount--);
        pending = Promise.all([pending, sent]).then(() => undefined);
      },
    });
  } catch {
    // Leave document.cookie as it is rather than break the page.
  }

  try {
    Object.defineProperty(window, 'cookieStore', { configurable: true, enumerable: true, get: () => undefined });
  } catch {
    // Not there.
  }

  // --- Requests wait for cookies written just before them ------------------------

  const sameSite = (target: string): boolean => {
    try {
      const host = new URL(target, location.href).hostname;
      const base = location.hostname.split('.').slice(-2).join('.');
      return host === base || host.endsWith(`.${base}`);
    } catch {
      return false;
    }
  };
  const realFetch = window.fetch;
  if (typeof realFetch === 'function') {
    const laneFetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const run = () => realFetch.call(window, input, init);
      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
      const started = pendingCount ? pending.then(run) : run();
      // A sign-in or refresh (POST) may set cookies: let the lane take them before the page goes on.
      if (method === 'GET' || method === 'HEAD') return started;
      return started.then(async (response) => {
        if (sameSite(response.url)) await tell('flush', {}, 800);
        return response;
      });
    };
    Object.defineProperty(laneFetch, 'name', { value: 'fetch' });
    window.fetch = laneFetch as typeof fetch;
  }
  const realSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    if (!pendingCount) return realSend.call(this, body);
    void pending.then(() => realSend.call(this, body));
  };

  // --- IndexedDB, BroadcastChannel, Web Locks -----------------------------------

  try {
    const factory = IDBFactory.prototype;
    const open = factory.open;
    const remove = factory.deleteDatabase;
    const databases = factory.databases;
    factory.open = function (this: IDBFactory, name: string, version?: number) {
      return version === undefined ? open.call(this, ns + name) : open.call(this, ns + name, version);
    };
    factory.deleteDatabase = function (this: IDBFactory, name: string) {
      return remove.call(this, ns + name);
    };
    if (databases) {
      factory.databases = async function (this: IDBFactory) {
        const list = await databases.call(this);
        return list
          .filter((info) => info.name?.startsWith(ns))
          .map((info) => ({ ...info, name: info.name!.slice(ns.length) }));
      };
    }
    const nameDescriptor = Object.getOwnPropertyDescriptor(IDBDatabase.prototype, 'name');
    if (nameDescriptor?.get) {
      const getName = nameDescriptor.get;
      Object.defineProperty(IDBDatabase.prototype, 'name', {
        ...nameDescriptor,
        get(this: IDBDatabase) {
          const name = getName.call(this) as string;
          return name.startsWith(ns) ? name.slice(ns.length) : name;
        },
      });
    }
  } catch {
    // No IndexedDB.
  }

  try {
    const RealChannel = window.BroadcastChannel;
    if (RealChannel) {
      const names = new WeakMap<BroadcastChannel, string>();
      class LaneChannel extends RealChannel {
        constructor(name: string) {
          super(ns + String(name));
          names.set(this, String(name));
        }
        override get name(): string {
          return names.get(this) ?? super.name;
        }
      }
      Object.defineProperty(LaneChannel, 'name', { value: 'BroadcastChannel' });
      window.BroadcastChannel = LaneChannel;
    }
  } catch {
    // Leave it.
  }

  try {
    const locks = (window as { LockManager?: { prototype: LockManager } }).LockManager?.prototype;
    if (locks) {
      const request = locks.request;
      locks.request = function (this: LockManager, name: string, ...rest: unknown[]) {
        return (request as (...args: unknown[]) => Promise<unknown>).call(this, ns + name, ...rest);
      } as LockManager['request'];
      const query = locks.query;
      locks.query = async function (this: LockManager) {
        const snapshot = await query.call(this);
        const strip = (list?: LockInfo[]) =>
          (list ?? [])
            .filter((info) => info.name?.startsWith(ns))
            .map((info) => ({ ...info, name: info.name!.slice(ns.length) }));
        return { held: strip(snapshot.held), pending: strip(snapshot.pending) };
      };
    }
  } catch {
    // No Web Locks.
  }

  // --- Service workers -----------------------------------------------------------

  try {
    const container = (window as { ServiceWorkerContainer?: { prototype: ServiceWorkerContainer } })
      .ServiceWorkerContainer?.prototype;
    if (container) {
      container.register = function () {
        return Promise.reject(new DOMException('Service workers are off in a separate tab.', 'SecurityError'));
      };
    }
    // A worker the site registered elsewhere answers this page's requests with the browser's own sign-in.
    if (navigator.serviceWorker?.controller) void tell('sw');
  } catch {
    // Not available here.
  }
})();
