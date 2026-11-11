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
import { registrableDomain } from '../core/domains';
import {
  LANE_CACHE_GUARD,
  LANE_PREFIX,
  LANE_TIMING,
  laneNamespace,
  parseCookie,
  parseLaneTiming,
  pathMatches,
} from '../core/lanes';

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

  // Captured before the page's own scripts run: they may replace these later. Instrumentation
  // (New Relic, Sentry…) wraps timers, promises and events once it loads: the shim's own work goes
  // through the browser's originals, so it never shows up there (nor trips it up).
  const apply = Reflect.apply;
  const weakGet = WeakMap.prototype.get;
  const weakSet = WeakMap.prototype.set;
  const NativePromise = Promise;
  const NativeCustomEvent = CustomEvent;
  const NativeStorageEvent = window.StorageEvent;
  const nativeSetTimeout = window.setTimeout;
  const nativeClearTimeout = window.clearTimeout;
  const nativeDispatch = EventTarget.prototype.dispatchEvent;
  const nativeListen = EventTarget.prototype.addEventListener;
  const toJson = JSON.stringify;
  const fromJson = JSON.parse;
  const later = (run: () => void, ms: number): number =>
    apply(nativeSetTimeout, window, [run, ms]) as unknown as number;
  const cancel = (timer: number): void => void apply(nativeClearTimeout, window, [timer]);
  const dispatch = (target: EventTarget, event: Event): void => void apply(nativeDispatch, target, [event]);
  const listen = (target: EventTarget, type: string, run: (event: Event) => void, capture = false): void =>
    void apply(nativeListen, target, [type, run, capture]);

  const realLocal = (() => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  })();

  // --- Web storage -------------------------------------------------------------

  type StorageMethod = 'getItem' | 'setItem' | 'removeItem' | 'clear' | 'key';
  /** The browser's own Storage methods: the views call these, so a site's wrappers never see lane names. */
  const native = (() => {
    try {
      const proto = Storage.prototype;
      const length = Object.getOwnPropertyDescriptor(proto, 'length')?.get;
      if (!length) return null;
      return {
        proto,
        length: length as (this: Storage) => number,
        getItem: proto.getItem,
        setItem: proto.setItem,
        removeItem: proto.removeItem,
        clear: proto.clear,
        key: proto.key,
      };
    } catch {
      return null;
    }
  })();

  const lengthOf = (storage: Storage): number => apply(native!.length, storage, []);
  const keyAt = (storage: Storage, index: number): string | null => apply(native!.key, storage, [index]);

  function hasLaneKeys(storage: Storage): boolean {
    for (let i = 0; i < lengthOf(storage); i++) if (keyAt(storage, i)?.startsWith(LANE_PREFIX)) return true;
    return false;
  }

  /** What one of our Storage views does, with the real Storage under it. */
  type View = {
    real: Storage;
    getItem: (key: unknown) => string | null;
    setItem: (key: unknown, value: unknown) => void;
    removeItem: (key: unknown) => void;
    clear: () => void;
    key: (index: unknown) => string | null;
    length: () => number;
  };
  const views = new WeakMap<object, View>();
  const viewOf = (value: unknown): View | undefined =>
    value !== null && (typeof value === 'object' || typeof value === 'function')
      ? (apply(weakGet, views, [value]) as View | undefined)
      : undefined;

  /**
   * Storage.prototype's methods and `length`, as wrappers that act on our view when called on one
   * (Storage.prototype.getItem.call(localStorage, …), or a method a site added to the prototype)
   * and are the browser's own otherwise. Same names, lengths and property attributes.
   */
  let prototypeWrapped = false;
  function wrapPrototype(): void {
    if (prototypeWrapped || !native) return;
    prototypeWrapped = true;
    const { proto } = native;
    const arity: Record<StorageMethod, number> = { getItem: 1, setItem: 2, removeItem: 1, clear: 0, key: 1 };
    for (const name of Object.keys(arity) as StorageMethod[]) {
      const descriptor = Object.getOwnPropertyDescriptor(proto, name);
      const original = native[name] as (...args: unknown[]) => unknown;
      if (!descriptor || typeof original !== 'function') continue;
      const wrapper = {
        [name](this: unknown, ...args: unknown[]): unknown {
          const view = viewOf(this);
          // Too few arguments: the browser's own error, as it would throw it.
          if (!view || args.length < arity[name]) return apply(original, view ? view.real : this, args);
          return (view[name] as (...values: unknown[]) => unknown)(...args);
        },
      }[name]!;
      Object.defineProperty(wrapper, 'length', { value: arity[name] });
      Object.defineProperty(proto, name, { ...descriptor, value: wrapper });
    }
    const lengthDescriptor = Object.getOwnPropertyDescriptor(proto, 'length');
    const nativeLength = native.length;
    const getter = Object.getOwnPropertyDescriptor(
      {
        get length(): number {
          const view = viewOf(this);
          return view ? view.length() : (apply(nativeLength, this, []) as number);
        },
      },
      'length',
    )!.get!;
    if (lengthDescriptor) Object.defineProperty(proto, 'length', { ...lengthDescriptor, get: getter });
  }

  /** A Storage that shows the page only its own keys: the lane's (prefix stripped), or everything but the lanes'. */
  function scopedStorage(real: Storage, prefix: string | null): Storage {
    const { proto, getItem, setItem, removeItem } = native!;
    const stored = (key: string) => (prefix ? prefix + key : key);
    const shown = (raw: string): string | null =>
      prefix ? (raw.startsWith(prefix) ? raw.slice(prefix.length) : null) : raw.startsWith(LANE_PREFIX) ? null : raw;
    const keys = (): string[] => {
      const out: string[] = [];
      for (let i = 0; i < lengthOf(real); i++) {
        const raw = keyAt(real, i);
        const key = raw === null ? null : shown(raw);
        if (key !== null) out.push(key);
      }
      return out;
    };
    const view: View = {
      real,
      getItem: (key) => apply(getItem, real, [stored(String(key))]) as string | null,
      setItem: (key, value) => void apply(setItem, real, [stored(String(key)), String(value)]),
      removeItem: (key) => void apply(removeItem, real, [stored(String(key))]),
      clear: () => {
        for (const key of keys()) apply(removeItem, real, [stored(key)]);
      },
      // As the browser converts it (an unsigned long).
      key: (index) => keys()[Number(index) >>> 0] ?? null,
      length: () => keys().length,
    };
    // A real Storage keeps symbol-keyed properties as ordinary ones: so does the target.
    const target = Object.create(proto) as Storage;
    const proxy = new Proxy(target, {
      get(_target, prop, receiver) {
        // Methods and `length` come from the prototype, as on a real Storage (a site may have wrapped them).
        if (prop in proto) return Reflect.get(proto, prop, receiver);
        if (typeof prop === 'symbol') return Reflect.get(target, prop);
        return view.getItem(prop) ?? undefined;
      },
      set(_target, prop, value) {
        if (typeof prop === 'symbol') return Reflect.set(target, prop, value);
        view.setItem(prop, value);
        return true;
      },
      has(_target, prop) {
        if (prop in proto) return true;
        if (typeof prop === 'symbol') return prop in target;
        return view.getItem(prop) !== null;
      },
      deleteProperty(_target, prop) {
        if (typeof prop === 'symbol') return Reflect.deleteProperty(target, prop);
        // A name the prototype has isn't an item there (as on a real Storage).
        if (!(prop in proto)) view.removeItem(prop);
        return true;
      },
      ownKeys() {
        return [...keys(), ...Reflect.ownKeys(target).filter((key) => typeof key === 'symbol')];
      },
      getOwnPropertyDescriptor(_target, prop) {
        if (typeof prop === 'symbol') return Reflect.getOwnPropertyDescriptor(target, prop);
        const value = view.getItem(prop);
        return value === null ? undefined : { value, writable: true, enumerable: true, configurable: true };
      },
      defineProperty(_target, prop, descriptor) {
        if (typeof prop === 'symbol') return Reflect.defineProperty(target, prop, descriptor);
        // Like a real Storage: a value is stored, anything else is refused.
        if (!('value' in descriptor) || descriptor.configurable === false) return false;
        view.setItem(prop, descriptor.value);
        return true;
      },
      // A Storage can't be frozen or sealed.
      preventExtensions: () => false,
    });
    apply(weakSet, views, [proxy, view]);
    return proxy;
  }

  function installStorage(prefix: string | null): void {
    if (!realLocal || !native) return;
    let view: Storage;
    try {
      view = scopedStorage(realLocal, prefix);
      Object.defineProperty(window, 'localStorage', { configurable: true, enumerable: true, get: () => view });
    } catch {
      return;
    }
    try {
      wrapPrototype();
    } catch {
      // The view works without them (only calls through Storage.prototype don't).
    }
    // Other tabs' changes arrive as "storage" events: pass on only this view's, under its names.
    const synthetic = new WeakSet<Event>();
    listen(
      window,
      'storage',
      (raw) => {
        const event = raw as StorageEvent;
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
        const copy = new NativeStorageEvent('storage', {
          key,
          oldValue: event.oldValue,
          newValue: event.newValue,
          url: event.url,
        });
        Object.defineProperty(copy, 'storageArea', { value: view });
        synthetic.add(copy);
        dispatch(window, copy);
      },
      true,
    );
  }

  if (!lane) {
    // Not a separate tab: only keep the lanes' keys out of the page's sight (and out of its clear()).
    if (realLocal && native && hasLaneKeys(realLocal)) installStorage(null);
    return;
  }

  const ns = laneNamespace(lane.token);
  installStorage(ns);

  // --- Messages to the relay ---------------------------------------------------

  let nextId = 0;
  const waiting = new Map<number, () => void>();
  /** Cookie writes of the page the worker hasn't answered yet. */
  const writes = new Set<number>();
  /** Requests waiting for the writes made before them. */
  const writeWaiters: { ids: number[]; resolve: () => void }[] = [];
  function writeSettled(id: number): void {
    if (!writes.delete(id)) return;
    for (let i = writeWaiters.length - 1; i >= 0; i--) {
      const waiter = writeWaiters[i]!;
      if (waiter.ids.some((pending) => writes.has(pending))) continue;
      writeWaiters.splice(i, 1);
      waiter.resolve();
    }
  }
  /** Resolves once the cookie writes made so far are in the lane (or given up on). */
  function writesDone(): Promise<void> {
    const ids = [...writes];
    if (!ids.length) return NativePromise.resolve();
    return new NativePromise<void>((resolve) => writeWaiters.push({ ids, resolve }));
  }
  listen(document, FROM_RELAY, (event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (typeof detail !== 'string') return;
    try {
      const { id, cookies } = fromJson(detail) as { id?: unknown; cookies?: unknown };
      if (typeof id === 'number') {
        writeSettled(id);
        waiting.get(id)?.();
        waiting.delete(id);
      }
      // What document.cookie reads now in the lane (cookies the site's responses set included, and
      // what the lane made of the page's own writes), once none of them is still on its way.
      if (typeof cookies === 'string' && !writes.size) readJar(cookies);
    } catch {
      // Not ours.
    }
  });
  /** Sends to the extension; resolves when it has acted, or after a short while regardless. */
  function tell(kind: string, extra: Record<string, unknown> = {}, timeoutMs = 1500, id = ++nextId): Promise<void> {
    return new NativePromise<void>((resolve) => {
      const timer = later(() => {
        waiting.delete(id);
        writeSettled(id);
        resolve();
      }, timeoutMs);
      waiting.set(id, () => {
        cancel(timer);
        resolve();
      });
      dispatch(document, new NativeCustomEvent(TO_RELAY, { detail: toJson({ kind, id, ...extra }) }));
    });
  }

  // --- document.cookie ---------------------------------------------------------

  /** What document.cookie reads, in the browser's order: a name can come more than once (two paths or domains). */
  let jar: [string, string][] = [];
  function readJar(text: string): void {
    jar = [];
    for (const part of text ? text.split('; ') : []) {
      const eq = part.indexOf('=');
      jar.push(eq === -1 ? ['', part] : [part.slice(0, eq), part.slice(eq + 1)]);
    }
  }
  readJar(lane.cookies);

  const cookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
  try {
    Object.defineProperty(Document.prototype, 'cookie', {
      configurable: true,
      enumerable: true,
      get(this: Document) {
        if (this !== document) return cookieDescriptor?.get?.call(this) ?? '';
        return jar.map(([name, value]) => (name ? `${name}=${value}` : value)).join('; ');
      },
      set(this: Document, input: unknown) {
        if (this !== document) {
          cookieDescriptor?.set?.call(this, input);
          return;
        }
        const line = String(input);
        let parsed: ReturnType<typeof parseCookie>;
        try {
          parsed = parseCookie(line, new URL(location.href), 'script');
        } catch {
          parsed = null;
        }
        // What a browser ignores (HttpOnly from a script, Secure from an insecure page, a broken
        // prefix, another site's domain, an oversized cookie) changes nothing here either.
        if (!parsed) return;
        const { cookie, expired } = parsed;
        if (pathMatches(location.pathname || '/', cookie.path)) {
          // Until the lane answers: the cookie of that name this page sees (the lane's answer is exact).
          const at = jar.findIndex(([name]) => name === cookie.name);
          if (expired) {
            if (at !== -1) jar.splice(at, 1);
          } else if (at !== -1) jar[at] = [cookie.name, cookie.value];
          else jar.push([cookie.name, cookie.value]);
        }
        const id = ++nextId;
        writes.add(id);
        void tell('cookie', { line }, 1500, id);
      },
    });
  } catch {
    // Leave document.cookie as it is rather than break the page.
  }

  // cookieStore would read and write the browser's own cookies: in a lane it isn't there at all, so
  // `'cookieStore' in window` is false and libraries (universal-cookie…) take their fallback.
  try {
    for (let owner: object | null = window; owner; owner = Object.getPrototypeOf(owner)) {
      if (Object.prototype.hasOwnProperty.call(owner, 'cookieStore'))
        delete (owner as { cookieStore?: unknown }).cookieStore;
    }
    if ('cookieStore' in window) {
      Object.defineProperty(window, 'cookieStore', { configurable: true, enumerable: false, get: () => undefined });
    }
  } catch {
    // Leave it.
  }

  // --- Requests wait for cookies written just before them ------------------------

  const site = registrableDomain(location.hostname);
  const sameSite = (target: string): boolean => {
    try {
      const host = new URL(target, location.href).hostname.toLowerCase();
      return host === site || host.endsWith(`.${site}`);
    } catch {
      return false;
    }
  };
  const sameOrigin = (target: string): boolean => {
    try {
      return new URL(target, document.baseURI).origin === location.origin;
    } catch {
      return false;
    }
  };
  const isPlain = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) &&
    typeof value === 'object' &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

  const realFetch = window.fetch;
  if (typeof realFetch === 'function') {
    const laneFetch = function fetch(this: unknown, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      let options = init;
      let method = 'GET';
      try {
        const request = input instanceof Request ? input : null;
        method = String(init?.method ?? request?.method ?? 'GET').toUpperCase();
        // The browser's cache may hold the site's answers to its own account: the lane's calls to
        // its site don't use it (rules can't ask for that without a header CORS would preflight).
        const url = request ? request.url : input instanceof URL ? input.href : String(input);
        const cache = init?.cache ?? request?.cache ?? 'default';
        if (cache === 'default' && (init === undefined || isPlain(init)) && sameSite(url))
          options = { ...init, cache: 'no-store' };
      } catch {
        options = init;
      }
      const run = () => apply(realFetch, window, [input, options]) as Promise<Response>;
      // Nothing to wait for: the browser's own promise, untouched.
      if ((method === 'GET' || method === 'HEAD') && !writes.size) return run();
      return (async () => {
        if (writes.size) await writesDone();
        const response = await run();
        // A sign-in or refresh (POST) may set cookies: let the lane take them before the page goes on.
        if (method !== 'GET' && method !== 'HEAD' && sameSite(response.url)) await tell('flush', {}, 800);
        return response;
      })();
    };
    Object.defineProperty(laneFetch, 'length', { value: 1 });
    window.fetch = laneFetch as typeof fetch;
  }

  try {
    const xhr = XMLHttpRequest.prototype;
    const realOpen = xhr.open;
    const realSend = xhr.send;
    const realAbort = xhr.abort;
    const realHeader = xhr.setRequestHeader;
    /** Each request as last opened: its address, whether it is asynchronous, and which opening it is. */
    const opened = new WeakMap<XMLHttpRequest, { url: string; async: boolean; at: number }>();
    let openings = 0;
    xhr.open = function open(this: XMLHttpRequest, ...args: unknown[]) {
      const result = apply(realOpen, this, args) as void;
      // open(method, url) is asynchronous; open(method, url, async, …) is what `async` says.
      opened.set(this, { url: String(args[1]), async: args.length < 3 || Boolean(args[2]), at: ++openings });
      return result;
    } as typeof xhr.open;
    Object.defineProperty(xhr.open, 'length', { value: 2 });
    xhr.abort = function abort(this: XMLHttpRequest) {
      opened.delete(this);
      return apply(realAbort, this, []) as void;
    };
    xhr.send = function send(this: XMLHttpRequest, ...args: unknown[]) {
      const request = opened.get(this);
      if (request && this.readyState === XMLHttpRequest.OPENED && sameOrigin(request.url)) {
        // As for fetch: the browser's cache neither answers nor keeps it (it may answer the
        // browser's own tabs with it). A same-origin call: no CORS to mind.
        try {
          apply(realHeader, this, ['Cache-Control', 'no-cache']);
          apply(realHeader, this, ['If-Range', LANE_CACHE_GUARD]);
        } catch {
          // Sent already: send() throws below, as it always does.
        }
      }
      // Synchronous requests, and anything send() would refuse, go as they are (errors included).
      if (!writes.size || !request?.async || this.readyState !== XMLHttpRequest.OPENED)
        return apply(realSend, this, args) as void;
      // Cookies written just before go along: send once they are in place, unless the page
      // opened the request again or aborted it meanwhile.
      const at = request.at;
      void (async () => {
        await writesDone();
        if (opened.get(this)?.at !== at || this.readyState !== XMLHttpRequest.OPENED) return;
        try {
          apply(realSend, this, args);
        } catch {
          // Sent meanwhile.
        }
      })();
    };
  } catch {
    // No XMLHttpRequest here.
  }

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
