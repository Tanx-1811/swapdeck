/**
 * Part of content/lane-main.ts (a separate tab's page): XMLHttpRequest in a lane.
 *
 * - Requests wait for cookie writes the page made just before them (so they carry them).
 * - The browser's HTTP cache may hold the site's answers to the browser's own account, and would
 *   give the lane's answers to the browser's tabs: a lane's requests must neither read nor feed it.
 *   A same-origin request gets the If-Range guard (no CORS there). A request to another origin of
 *   the app can't get a header without a CORS preflight its API may refuse, and XHR has no cache
 *   mode: an asynchronous GET or HEAD there is made with fetch(…, { cache: 'no-store' }) instead,
 *   the request object showing its progress, answer and events exactly as XHR does. What that
 *   can't show the same way (synchronous requests, user/password in open(), overrideMimeType,
 *   responseType "document") goes as it is.
 */
import { LANE_CACHE_GUARD } from '../core/lanes';
import type { LanePageKit } from './lane-kit';

const UNSENT = 0;
const OPENED = 1;
const HEADERS_RECEIVED = 2;
const LOADING = 3;
const DONE = 4;

/** Each request as last opened: its method and address, whether asynchronous, which opening, its headers. */
type Opened = {
  method: string;
  url: string;
  async: boolean;
  at: number;
  headers: [string, string][];
  /** open() was given a user name (fetch can't take one). */
  user: boolean;
  mime: boolean;
};

/** A request made with fetch on the page's behalf, and what it shows. */
type Emulated = {
  state: number;
  status: number;
  statusText: string;
  url: string;
  headers: Headers | null;
  chunks: Uint8Array[];
  loaded: number;
  text: string;
  decoder: TextDecoder | null;
  response?: { value: unknown };
  failed: boolean;
  done: boolean;
  controller: AbortController;
  timer?: number;
};

const TAKEN_TYPES = new Set(['', 'text', 'json', 'arraybuffer', 'blob']);

export function installXhr(kit: LanePageKit): void {
  const { apply, later, cancel, dispatch, writesDone, writing, realFetch, sameSite, sameOrigin } = kit;
  const proto = XMLHttpRequest.prototype;
  const realOpen = proto.open;
  const realSend = proto.send;
  const realAbort = proto.abort;
  const realHeader = proto.setRequestHeader;
  const realMime = proto.overrideMimeType;
  const descriptor = (name: string) => Object.getOwnPropertyDescriptor(proto, name);
  const responseTypeOf = descriptor('responseType')?.get;
  const credentialsOf = descriptor('withCredentials')?.get;
  const timeoutOf = descriptor('timeout')?.get;
  const readyStateOf = descriptor('readyState')?.get;
  const NativeEvent = Event;
  const NativeProgressEvent = ProgressEvent;
  const NativeTextDecoder = TextDecoder;
  const NativeBlob = Blob;
  const NativeHeaders = Headers;
  const NativeDomException = DOMException;
  const NativeAbortController = AbortController;
  const readChunk = ReadableStreamDefaultReader.prototype.read;
  const getReader = ReadableStream.prototype.getReader;
  const parseJson = JSON.parse;
  if (!readyStateOf || !responseTypeOf) return;

  const opened = new WeakMap<XMLHttpRequest, Opened>();
  const emulated = new WeakMap<XMLHttpRequest, Emulated>();
  let openings = 0;
  const nativeState = (xhr: XMLHttpRequest) => apply(readyStateOf, xhr, []) as number;
  const invalidState = (what: string) =>
    new NativeDomException(
      `Failed to execute '${what}' on 'XMLHttpRequest': The object's state must be OPENED.`,
      'InvalidStateError',
    );

  proto.open = {
    open(this: XMLHttpRequest, ...args: unknown[]) {
      const previous = emulated.get(this);
      const result = apply(realOpen, this, args) as void;
      // Opened again: what was made for the last opening stops, silently (as open() does).
      if (previous) {
        previous.done = true;
        previous.controller.abort();
        cancel(previous.timer ?? 0);
        emulated.delete(this);
      }
      // open(method, url) is asynchronous; open(method, url, async, …) is what `async` says.
      opened.set(this, {
        method: String(args[0]).toUpperCase(),
        url: String(args[1]),
        async: args.length < 3 || Boolean(args[2]),
        at: ++openings,
        headers: [],
        user: args[3] !== undefined && args[3] !== null,
        mime: false,
      });
      return result;
    },
  }.open as typeof proto.open;
  Object.defineProperty(proto.open, 'length', { value: 2 });

  proto.setRequestHeader = {
    setRequestHeader(this: XMLHttpRequest, name: string, value: string) {
      if (emulated.has(this)) throw invalidState('setRequestHeader');
      const result = apply(realHeader, this, [name, value]) as void;
      opened.get(this)?.headers.push([String(name), String(value)]);
      return result;
    },
  }.setRequestHeader;

  proto.overrideMimeType = {
    overrideMimeType(this: XMLHttpRequest, mime: string) {
      const request = opened.get(this);
      if (request) request.mime = true;
      return apply(realMime, this, [mime]) as void;
    },
  }.overrideMimeType;

  proto.abort = {
    abort(this: XMLHttpRequest) {
      const request = emulated.get(this);
      opened.delete(this);
      if (request) {
        if (!request.done) finish(this, request, 'abort');
        request.state = UNSENT;
      }
      return apply(realAbort, this, []) as void;
    },
  }.abort;

  proto.send = {
    send(this: XMLHttpRequest, ...args: unknown[]) {
      if (emulated.has(this)) throw invalidState('send');
      const request = opened.get(this);
      const isOpened = nativeState(this) === OPENED;
      if (request && isOpened && sameOrigin(request.url)) {
        // The browser's cache neither answers nor keeps it (it may answer the browser's own tabs
        // with it). A same-origin call: no CORS to mind.
        try {
          apply(realHeader, this, ['Cache-Control', 'no-cache']);
          apply(realHeader, this, ['If-Range', LANE_CACHE_GUARD]);
        } catch {
          // Sent already: send() throws below, as it always does.
        }
      } else if (request && isOpened && takeable(this, request)) {
        takeOver(this, request);
        return;
      }
      // Synchronous requests, and anything send() would refuse, go as they are (errors included).
      if (!writing() || !request?.async || !isOpened) return apply(realSend, this, args) as void;
      // Cookies written just before go along: send once they are in place, unless the page
      // opened the request again or aborted it meanwhile.
      const at = request.at;
      void (async () => {
        await writesDone();
        if (opened.get(this)?.at !== at || nativeState(this) !== OPENED) return;
        try {
          apply(realSend, this, args);
        } catch {
          // Sent meanwhile.
        }
      })();
    },
  }.send;

  /** An asynchronous GET or HEAD to another origin of the app, of a kind fetch can show the same way. */
  function takeable(xhr: XMLHttpRequest, request: Opened): boolean {
    if (!request.async || request.user || request.mime) return false;
    if (request.method !== 'GET' && request.method !== 'HEAD') return false;
    if (!TAKEN_TYPES.has(String(apply(responseTypeOf!, xhr, [])))) return false;
    return sameSite(request.url);
  }

  const fire = (xhr: XMLHttpRequest, type: string) => dispatch(xhr, new NativeEvent(type));
  const progress = (xhr: XMLHttpRequest, type: string, loaded: number, total: number) =>
    dispatch(xhr, new NativeProgressEvent(type, { lengthComputable: total > 0, loaded, total }));

  function takeOver(xhr: XMLHttpRequest, request: Opened): void {
    const state: Emulated = {
      state: OPENED,
      status: 0,
      statusText: '',
      url: '',
      headers: null,
      chunks: [],
      loaded: 0,
      text: '',
      decoder: null,
      failed: false,
      done: false,
      controller: new NativeAbortController(),
    };
    emulated.set(xhr, state);
    const live = () => emulated.get(xhr) === state && !state.done;
    const timeout = Number(timeoutOf ? apply(timeoutOf, xhr, []) : 0) || 0;
    const credentials = Boolean(credentialsOf ? apply(credentialsOf, xhr, []) : false);
    progress(xhr, 'loadstart', 0, 0);
    if (timeout > 0) state.timer = later(() => live() && finish(xhr, state, 'timeout'), timeout);
    void (async () => {
      if (writing()) await writesDone();
      if (!live()) return;
      const headers = new NativeHeaders();
      for (const [name, value] of request.headers) {
        try {
          headers.append(name, value);
        } catch {
          // The browser would have refused it already.
        }
      }
      let response: Response;
      try {
        response = (await apply(realFetch, window, [
          new URL(request.url, document.baseURI).href,
          {
            method: request.method,
            headers,
            credentials: credentials ? 'include' : 'same-origin',
            // Neither read from nor kept in the browser's HTTP cache.
            cache: 'no-store',
            signal: state.controller.signal,
          },
        ])) as Response;
      } catch {
        if (live()) finish(xhr, state, 'error');
        return;
      }
      if (!live()) return;
      state.status = response.status;
      state.statusText = response.statusText;
      state.url = response.url;
      state.headers = response.headers;
      const type = String(apply(responseTypeOf!, xhr, []));
      if (type === '' || type === 'text') state.decoder = decoderFor(response.headers.get('content-type'));
      state.state = HEADERS_RECEIVED;
      fire(xhr, 'readystatechange');
      const total = Number(response.headers.get('content-length')) || 0;
      if (response.body && live()) {
        const reader = apply(getReader, response.body, []) as ReadableStreamDefaultReader<Uint8Array>;
        for (;;) {
          let chunk: ReadableStreamReadResult<Uint8Array>;
          try {
            chunk = (await apply(readChunk, reader, [])) as ReadableStreamReadResult<Uint8Array>;
          } catch {
            if (live()) finish(xhr, state, 'error');
            return;
          }
          if (!live()) {
            void reader.cancel().catch(() => undefined);
            return;
          }
          if (chunk.done) break;
          state.chunks.push(chunk.value);
          state.loaded += chunk.value.byteLength;
          if (state.decoder) state.text += state.decoder.decode(chunk.value, { stream: true });
          state.state = LOADING;
          fire(xhr, 'readystatechange');
          if (!live()) return;
          progress(xhr, 'progress', state.loaded, Math.max(total, state.loaded));
          if (!live()) return;
        }
      }
      if (!live()) return;
      if (state.decoder) state.text += state.decoder.decode();
      finish(xhr, state, 'load');
    })();
  }

  function decoderFor(contentType: string | null): TextDecoder {
    const charset = /;\s*charset\s*=\s*"?([^";\s]+)/i.exec(contentType ?? '')?.[1];
    try {
      return new NativeTextDecoder(charset ?? 'utf-8');
    } catch {
      return new NativeTextDecoder('utf-8');
    }
  }

  /** The end of a request: its answer (load), or none (error, timeout, abort), with XHR's events in XHR's order. */
  function finish(xhr: XMLHttpRequest, state: Emulated, kind: 'load' | 'error' | 'timeout' | 'abort'): void {
    if (state.done) return;
    state.done = true;
    cancel(state.timer ?? 0);
    if (kind !== 'load') {
      state.controller.abort();
      state.failed = true;
      state.status = 0;
      state.statusText = '';
      state.headers = null;
      state.chunks = [];
      state.text = '';
      state.state = DONE;
      fire(xhr, 'readystatechange');
      progress(xhr, kind, 0, 0);
      progress(xhr, 'loadend', 0, 0);
      return;
    }
    const total = Math.max(Number(state.headers?.get('content-length')) || 0, state.loaded);
    progress(xhr, 'progress', state.loaded, total);
    state.state = DONE;
    fire(xhr, 'readystatechange');
    progress(xhr, 'load', state.loaded, total);
    progress(xhr, 'loadend', state.loaded, total);
  }

  const bytes = (state: Emulated): Uint8Array => {
    const all = new Uint8Array(state.loaded);
    let at = 0;
    for (const chunk of state.chunks) {
      all.set(chunk, at);
      at += chunk.byteLength;
    }
    return all;
  };

  function responseOf(xhr: XMLHttpRequest, state: Emulated): unknown {
    const type = String(apply(responseTypeOf!, xhr, []));
    if (type === '' || type === 'text') return state.state >= LOADING && !state.failed ? state.text : '';
    if (state.state !== DONE || state.failed) return null;
    if (!state.response) {
      const contentType = state.headers?.get('content-type') ?? '';
      let value: unknown = null;
      if (type === 'json') {
        try {
          value = parseJson(new NativeTextDecoder('utf-8').decode(bytes(state)));
        } catch {
          value = null;
        }
      } else if (type === 'arraybuffer') {
        value = bytes(state).buffer;
      } else if (type === 'blob') {
        value = new NativeBlob(state.chunks as BlobPart[], { type: contentType });
      }
      state.response = { value };
    }
    return state.response.value;
  }

  /** Getters of XHR that show the emulated request (the browser's own for every other one). */
  function show(name: string, value: (state: Emulated, xhr: XMLHttpRequest) => unknown): void {
    const own = descriptor(name);
    if (!own?.get) return;
    const nativeGet = own.get;
    const getter = Object.getOwnPropertyDescriptor(
      {
        get [name]() {
          const state = emulated.get(this as unknown as XMLHttpRequest);
          return state ? value(state, this as unknown as XMLHttpRequest) : apply(nativeGet, this, []);
        },
      },
      name,
    )!.get!;
    Object.defineProperty(proto, name, { ...own, get: getter });
  }

  show('readyState', (state) => state.state);
  show('status', (state) => (state.state >= HEADERS_RECEIVED && !state.failed ? state.status : 0));
  show('statusText', (state) => (state.state >= HEADERS_RECEIVED && !state.failed ? state.statusText : ''));
  show('responseURL', (state) => (state.state >= HEADERS_RECEIVED && !state.failed ? state.url : ''));
  show('response', (state, xhr) => responseOf(xhr, state));
  show('responseText', (state, xhr) => {
    const type = String(apply(responseTypeOf!, xhr, []));
    if (type !== '' && type !== 'text')
      throw new NativeDomException(
        `Failed to read the 'responseText' property from 'XMLHttpRequest': The value is only accessible if the object's 'responseType' is '' or 'text' (was '${type}').`,
        'InvalidStateError',
      );
    return responseOf(xhr, state);
  });
  show('responseXML', (state, xhr) => {
    const type = String(apply(responseTypeOf!, xhr, []));
    if (type !== '' && type !== 'document')
      throw new NativeDomException(
        `Failed to read the 'responseXML' property from 'XMLHttpRequest': The value is only accessible if the object's 'responseType' is '' or 'document' (was '${type}').`,
        'InvalidStateError',
      );
    if (state.state !== DONE || state.failed) return null;
    const mime = (state.headers?.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (!/^(text|application)\/xml$|\+xml$/.test(mime)) return null;
    const doc = new DOMParser().parseFromString(state.text, mime as DOMParserSupportedType);
    return doc.getElementsByTagName('parsererror').length ? null : doc;
  });

  const getHeader = proto.getResponseHeader;
  proto.getResponseHeader = {
    getResponseHeader(this: XMLHttpRequest, name: string) {
      const state = emulated.get(this);
      if (!state) return apply(getHeader, this, [name]) as string | null;
      if (state.state < HEADERS_RECEIVED || state.failed || !state.headers) return null;
      try {
        return state.headers.get(String(name));
      } catch {
        return null;
      }
    },
  }.getResponseHeader;

  const allHeaders = proto.getAllResponseHeaders;
  proto.getAllResponseHeaders = {
    getAllResponseHeaders(this: XMLHttpRequest) {
      const state = emulated.get(this);
      if (!state) return apply(allHeaders, this, []) as string;
      if (state.state < HEADERS_RECEIVED || state.failed || !state.headers) return '';
      let text = '';
      // Headers lists names in lower case, sorted, values combined: as XHR shows them.
      for (const [name, value] of state.headers) text += `${name}: ${value}\r\n`;
      return text;
    },
  }.getAllResponseHeaders;
}
