/**
 * Runs in the extension's isolated world at document_start, next to content/lane-main.ts, on the
 * sites of apps while separate tabs are open. It tells the worker which lane the page loaded in
 * (from the same Server-Timing entry), so a page that came from the browser's cache without its
 * lane is loaded again; passes the page's cookie writes, "flush" requests and the windows it opens
 * on to the worker; and keeps the page's document.cookie in step with the lane's jar (cookies set
 * by the site's responses). The worker checks every message against the tab it came from
 * (background/lanes.ts).
 */
import { LANE_TIMING, parseLaneTiming } from '../core/lanes';

const TO_RELAY = 'swapdeck-lane';
const FROM_RELAY = 'swapdeck-lane-ack';

(() => {
  let token: string | null = null;
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const entry = nav?.serverTiming?.find((item) => item.name === LANE_TIMING);
    token = entry ? (parseLaneTiming(entry.description)?.token ?? null) : null;
  } catch {
    // No timing here.
  }

  /**
   * The address whose cookies this document reads and writes: its own, or for about:blank and
   * srcdoc documents (no address of their own) the one of the page that made them — its parent,
   * or the page that opened it (the worker accepts it only on this document's origin).
   */
  const blank = location.protocol === 'about:';
  const cookieUrl = (() => {
    if (!blank) return location.href;
    try {
      let at: Window = window;
      for (let hops = 0; hops < 10 && at.location.protocol === 'about:'; hops++) {
        const next = (at.parent !== at ? at.parent : at.opener) as Window | null;
        if (!next) break;
        at = next;
      }
      if (at.location.protocol !== 'about:') return at.location.href;
    } catch {
      // A page of another origin around it.
    }
    return location.href;
  })();

  type Answer = { ok?: boolean; cookies?: unknown } | undefined;
  const send = (message: Record<string, unknown>): Promise<Answer> =>
    chrome.runtime.sendMessage({ swapdeckLane: true, url: cookieUrl, ...message }).catch(() => undefined);

  /** Hands the page script an answer: which request it settles, whether it was taken, what document.cookie reads now. */
  const answer = (id: unknown, reply: Answer) => {
    const detail: { id?: number; ok?: boolean; cookies?: string } = {};
    if (typeof id === 'number') {
      detail.id = id;
      detail.ok = reply?.ok === true;
    }
    if (typeof reply?.cookies === 'string') detail.cookies = reply.cookies;
    if (detail.id !== undefined || detail.cookies !== undefined)
      document.dispatchEvent(new CustomEvent(FROM_RELAY, { detail: JSON.stringify(detail) }));
  };

  if (window === window.top && /^https?:$/.test(location.protocol)) void send({ kind: 'hello', token });

  // A lane page asks what document.cookie reads now (frames get only the lane's name in their timing,
  // about:blank and srcdoc frames not even that, and cookies may have changed since the page's response).
  if (token || blank) void send({ kind: 'sync' }).then((reply) => answer(undefined, reply));

  // The site set cookies in the lane: document.cookie follows.
  chrome.runtime.onMessage.addListener((message: unknown) => {
    if ((message as { swapdeckLane?: unknown } | null)?.swapdeckLane !== 'changed') return;
    void send({ kind: 'sync' }).then((reply) => answer(undefined, reply));
  });

  const KINDS = new Set(['cookie', 'flush', 'sw', 'opening', 'adopt']);
  document.addEventListener(TO_RELAY, (event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (typeof detail !== 'string' || detail.length > 10_000) return;
    let message: { kind?: unknown; id?: unknown; line?: unknown; nonce?: unknown };
    try {
      message = JSON.parse(detail) as typeof message;
    } catch {
      return;
    }
    const { kind, id } = message;
    if (typeof kind !== 'string' || !KINDS.has(kind)) return;
    void send({
      kind,
      line: typeof message.line === 'string' ? message.line : '',
      ...(typeof message.nonce === 'string' ? { nonce: message.nonce } : {}),
    }).then(
      (reply) => answer(id, reply),
      () => answer(id, undefined),
    );
  });
})();
