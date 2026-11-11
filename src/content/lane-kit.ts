/**
 * What content/lane-main.ts hands its parts (lane-open.ts, lane-xhr.ts): the browser's own
 * functions it captured at document_start (the page may wrap the originals later) and its line to
 * the relay. Types only: lane-main builds it.
 */
export type LanePageKit = {
  apply: typeof Reflect.apply;
  /** setTimeout / clearTimeout as the browser has them. */
  later: (run: () => void, ms: number) => number;
  cancel: (timer: number) => void;
  dispatch: (target: EventTarget, event: Event) => void;
  listen: (target: EventTarget, type: string, run: (event: Event) => void, capture?: boolean) => void;
  NativeCustomEvent: typeof CustomEvent;
  NativePromise: PromiseConstructor;
  toJson: typeof JSON.stringify;
  /** Sends to the extension; resolves with whether it was taken (undefined: no answer in time). */
  tell: (kind: string, extra?: Record<string, unknown>, timeoutMs?: number) => Promise<boolean | undefined>;
  /** Resolves once the page's cookie writes made so far are in the lane. */
  writesDone: () => Promise<void>;
  /** Whether cookie writes are still on their way. */
  writing: () => boolean;
  /** The browser's own fetch. */
  realFetch: typeof fetch;
  /** Whether an address is on this page's site (another origin of the app, usually), or its origin. */
  sameSite: (url: string) => boolean;
  sameOrigin: (url: string) => boolean;
};
