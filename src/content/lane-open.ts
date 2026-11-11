/**
 * Part of content/lane-main.ts (a separate tab's page): windows the page opens join its lane before
 * their first request. A tab the browser opens for a link or a form starts loading at once, before
 * the worker can add it to the lane's rules — its first request would carry the browser's cookies
 * (and a form would be posted as the browser's account). So window.open, links and forms that open
 * a new tab or window first open a blank one (same size and place, in the same user gesture: the
 * WindowProxy, `opener` and popup rules stay as the page expects), ask the worker to put it in the
 * lane (a one-time nonce the blank window's relay confirms: `opening` / `adopt`), and only then send
 * it where it was going — the link followed, the form's data posted into it.
 *
 * Links the browser opens itself (middle or Ctrl-click, the link's menu) are GETs: the worker adds
 * such a tab once its first page shows the app asked for it, and loads it again. A form submitted
 * with Ctrl or Shift is sent here like one with a target.
 */
import type { LanePageKit } from './lane-kit';

const NONCE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function installOpenRouting(kit: LanePageKit): void {
  const { apply, later, listen, tell, dispatch, NativeCustomEvent, toJson } = kit;
  const nativeOpen = window.open;
  const nativeClick = HTMLElement.prototype.click;
  const nativeSubmit = HTMLFormElement.prototype.submit;
  const nativePrevent = Event.prototype.preventDefault;
  const nativeStop = Event.prototype.stopPropagation;
  const nativeStopNow = Event.prototype.stopImmediatePropagation;
  const prevented = Object.getOwnPropertyDescriptor(Event.prototype, 'defaultPrevented')?.get;
  const cancelBubble = Object.getOwnPropertyDescriptor(Event.prototype, 'cancelBubble');
  const returnValue = Object.getOwnPropertyDescriptor(Event.prototype, 'returnValue');
  const composedPath = Event.prototype.composedPath;
  const nativeAddListener = EventTarget.prototype.addEventListener;
  const NativeFormData = FormData;
  const formEntries = FormData.prototype.entries;
  const NativeURL = URL;
  const randomValues = crypto.getRandomValues;
  if (typeof nativeOpen !== 'function' || !prevented) return;

  const isPrevented = (event: Event): boolean => Boolean(apply(prevented, event, []));
  const warn = (what: string) => console.warn(`Swapdeck: ${what}`);

  /** Windows opened here (they aren't new any more). */
  const opened = new WeakSet<Window>();

  function nonce(): string {
    const bytes = new Uint8Array(24);
    apply(randomValues, crypto, [bytes]);
    return Array.from(bytes, (byte) => NONCE_ALPHABET[byte % NONCE_ALPHABET.length]).join('');
  }

  /** A blank window this call just opened (not one of that name that was already there). */
  function isNew(w: Window): boolean {
    try {
      return (
        w !== window &&
        !opened.has(w) &&
        w.top === w &&
        w.opener === window &&
        w.location.href === 'about:blank' &&
        w.history.length <= 1
      );
    } catch {
      return false;
    }
  }

  const isOurs = (w: Window): boolean => opened.has(w);
  const isBlank = (w: Window): boolean => {
    try {
      return w.location.href === 'about:blank';
    } catch {
      return false;
    }
  };

  /** Asks the worker to put the new window's tab in the lane; true once its rules cover it. */
  async function join(w: Window): Promise<boolean> {
    const id = nonce();
    let settled = false;
    // The blank window's relay may start a moment after it: say it again until the worker answers.
    const knock = () => {
      if (settled) return;
      try {
        dispatch(w.document, new NativeCustomEvent('swapdeck-lane', { detail: toJson({ kind: 'adopt', nonce: id }) }));
      } catch {
        // Closed, or navigated away.
      }
      later(knock, 60);
    };
    knock();
    const ok = await tell('opening', { nonce: id }, 5000);
    settled = true;
    return ok === true;
  }

  /**
   * Sends a new window on once it is the lane's. A form is never posted from a window outside it
   * (it would be posted as the browser's account): the window closes instead.
   */
  function whenJoined(w: Window, go: () => void, options: { post?: boolean; sever?: boolean } = {}): void {
    opened.add(w);
    void (async () => {
      const ok = await join(w);
      if (w.closed) return;
      if (!ok && options.post) {
        warn('the form was not sent: its new tab could not join the separate tab');
        try {
          w.close();
        } catch {
          // Leave it.
        }
        return;
      }
      if (options.sever) {
        try {
          (w as { opener: unknown }).opener = null;
        } catch {
          // Leave it.
        }
      }
      try {
        go();
      } catch (error) {
        console.warn('Swapdeck:', error);
      }
    })();
  }

  /**
   * The blank window's document, at this page's address: document.open() called from here gives it
   * the address of the page calling it, so what it sends has this page as its referrer (a blank
   * document has none), as the page's own link or form would.
   */
  function asThisPage(w: Window): Document {
    const doc = w.document;
    try {
      doc.open();
      doc.close();
    } catch {
      // Sent without a referrer then.
    }
    return doc;
  }

  /** Follows a link in a window of ours, as the page's own link would go (referrer, its policy). */
  function navigate(w: Window, href: string, link: { noreferrer?: boolean; referrerPolicy?: string } = {}): void {
    if ((!link.noreferrer && !link.referrerPolicy) || !isBlank(w)) {
      // From this page: the referrer and initiator are this page's, as for the original link (a
      // window that was already open, maybe on another origin, only lets its address be set).
      w.location.href = href;
      return;
    }
    const doc = asThisPage(w);
    const anchor = doc.createElement('a');
    anchor.href = href;
    if (link.noreferrer) anchor.rel = 'noreferrer';
    if (link.referrerPolicy) anchor.referrerPolicy = link.referrerPolicy;
    (doc.body ?? doc.documentElement).append(anchor);
    apply(nativeClick, anchor, []);
  }

  /** "Open elsewhere" targets: _blank, or a name that isn't a frame of this page. */
  function opensElsewhere(target: string): boolean {
    const keyword = target.toLowerCase();
    if (!target || keyword === '_self' || keyword === '_parent' || keyword === '_top') return false;
    if (keyword === '_blank') return true;
    for (const holder of [window, window.top]) {
      try {
        const frame = (holder as unknown as Record<string, unknown>)?.[target] as Window | undefined;
        if (frame && frame.window === frame) return false;
      } catch {
        // Not readable: look on.
      }
    }
    return true;
  }

  const baseTarget = (): string => document.querySelector('base[target]')?.getAttribute('target') ?? '';

  // --- window.open -----------------------------------------------------------------

  function features(text: string): { noopener: boolean; noreferrer: boolean; rest: string } {
    let noopener = false;
    let noreferrer = false;
    const rest: string[] = [];
    for (const token of text.split(',')) {
      const [rawKey = '', ...value] = token.split('=');
      const key = rawKey.trim().toLowerCase();
      const raw = value.join('=').trim().toLowerCase();
      const on = raw === '' || raw === 'yes' || raw === 'true' || (Number.parseInt(raw, 10) || 0) !== 0;
      if (key === 'noopener') noopener ||= on;
      else if (key === 'noreferrer') noreferrer ||= on;
      else if (token.trim()) rest.push(token);
    }
    return { noopener: noopener || noreferrer, noreferrer, rest: rest.join(',') };
  }

  const laneOpen = {
    open(this: unknown, ...args: unknown[]): Window | null {
      const [url, target, featureText] = args;
      let href = '';
      let name = '_blank';
      let flags = { noopener: false, noreferrer: false, rest: '' };
      try {
        if (url !== undefined && url !== null && String(url) !== '')
          href = new NativeURL(String(url), document.baseURI).href;
        // A blank window stays blank: it only joins the lane (the page may send it somewhere later).
        if (href === 'about:blank') href = '';
        if (target !== undefined) name = String(target) || '_blank';
        flags = features(featureText === undefined ? '' : String(featureText));
      } catch {
        return apply(nativeOpen, this, args) as Window | null;
      }
      // Here, in a frame of this page, or a page that isn't the network's: as the browser does it.
      if (!opensElsewhere(name) || (href && !/^https?:/i.test(href)) || (flags.noopener && name !== '_blank'))
        return apply(nativeOpen, this, args) as Window | null;
      const w = apply(nativeOpen, this, ['', name, flags.rest]) as Window | null;
      if (!w) return null;
      if (!isNew(w)) {
        // A window of that name was already open: sent there now, as window.open does.
        if (href) {
          try {
            w.location.href = href;
          } catch {
            return apply(nativeOpen, this, args) as Window | null;
          }
        }
        return flags.noopener ? null : w;
      }
      whenJoined(w, () => href && navigate(w, href, { noreferrer: flags.noreferrer }), { sever: flags.noopener });
      return flags.noopener ? null : w;
    },
  }.open;
  Object.defineProperty(laneOpen, 'length', { value: 0 });
  try {
    window.open = laneOpen as typeof window.open;
  } catch {
    return;
  }

  // --- Links and forms: decided after the page's own handlers --------------------------

  /** Clicks and submits that would open a new window, and what sends them there instead. */
  const pending = new WeakMap<Event, () => void>();
  /** …taken over when the page stopped them on their way (its later preventDefault still cancels). */
  const taken = new WeakSet<Event>();
  const cancelled = new WeakSet<Event>();

  /** The page's handlers ran and left the default: send it into a window of the lane instead. */
  function decide(event: Event): void {
    const run = pending.get(event);
    if (!run) return;
    pending.delete(event);
    if (isPrevented(event)) return;
    apply(nativePrevent, event, []);
    run();
  }

  /** Runs `decide` after every handler of the page (a listener added now on window runs last). */
  function afterPage(event: Event, run: () => void): void {
    pending.set(event, run);
    const last = (seen: Event) => {
      if (seen === event) decide(event);
    };
    apply(nativeAddListener, window, [event.type, last, { once: true }]);
  }

  /** The page stopped the event before it reached window: decide once its handlers are done. */
  function stopped(event: Event): void {
    const run = pending.get(event);
    if (!run) return;
    pending.delete(event);
    if (isPrevented(event)) return;
    apply(nativePrevent, event, []);
    taken.add(event);
    later(() => {
      if (!cancelled.has(event)) run();
    }, 0);
  }

  try {
    const proto = Event.prototype;
    proto.stopPropagation = {
      stopPropagation(this: Event) {
        stopped(this);
        return apply(nativeStop, this, []) as void;
      },
    }.stopPropagation;
    proto.stopImmediatePropagation = {
      stopImmediatePropagation(this: Event) {
        stopped(this);
        return apply(nativeStopNow, this, []) as void;
      },
    }.stopImmediatePropagation;
    proto.preventDefault = {
      preventDefault(this: Event) {
        if (taken.has(this)) cancelled.add(this);
        return apply(nativePrevent, this, []) as void;
      },
    }.preventDefault;
    if (cancelBubble?.set) {
      const set = cancelBubble.set;
      Object.defineProperty(proto, 'cancelBubble', {
        ...cancelBubble,
        set: Object.getOwnPropertyDescriptor(
          {
            set cancelBubble(value: boolean) {
              if (value) stopped(this as unknown as Event);
              apply(set, this, [value]);
            },
          },
          'cancelBubble',
        )!.set,
      });
    }
    if (returnValue?.set) {
      const set = returnValue.set;
      Object.defineProperty(proto, 'returnValue', {
        ...returnValue,
        set: Object.getOwnPropertyDescriptor(
          {
            set returnValue(value: boolean) {
              if (!value && taken.has(this as unknown as Event)) cancelled.add(this as unknown as Event);
              apply(set, this, [value]);
            },
          },
          'returnValue',
        )!.set,
      });
    }
  } catch {
    // Without them, a stopped click opens its tab as the browser does (a GET, loaded again there).
  }

  const pathOf = (event: Event): EventTarget[] => {
    try {
      return apply(composedPath, event, []) as EventTarget[];
    } catch {
      return [];
    }
  };

  /** The last click on a submit button with Ctrl, Shift or Meta (the browser sends its form to a new tab). */
  let modifiedSubmitter: { element: Element; at: number } | null = null;

  listen(
    window,
    'click',
    (raw) => {
      const event = raw as MouseEvent;
      const path = pathOf(event);
      const element = path.find((node): node is HTMLElement => node instanceof HTMLElement);
      const modified = event.ctrlKey || event.metaKey || event.shiftKey;
      const button = element?.closest('button, input[type=submit], input[type=image]');
      modifiedSubmitter = modified && button ? { element: button, at: event.timeStamp } : null;
      const link = path.find(
        (node): node is HTMLAnchorElement | HTMLAreaElement =>
          node instanceof HTMLAnchorElement || node instanceof HTMLAreaElement,
      );
      // Modified and middle clicks are opened by the browser (GET only): the worker handles those tabs.
      if (!link || event.button !== 0 || modified || event.altKey || link.hasAttribute('download')) return;
      const href = link.href;
      const target = link.getAttribute('target') ?? baseTarget();
      if (!/^https?:/i.test(href) || !opensElsewhere(target)) return;
      const rel = ` ${(link.getAttribute('rel') ?? '').toLowerCase()} `;
      const noreferrer = rel.includes(' noreferrer ');
      // target=_blank means noopener unless rel=opener (Chrome 88+).
      const noopener =
        noreferrer || rel.includes(' noopener ') || (target.toLowerCase() === '_blank' && !rel.includes(' opener '));
      const referrerPolicy = link.getAttribute('referrerpolicy') ?? '';
      afterPage(event, () => {
        const w = apply(nativeOpen, window, [
          '',
          target.toLowerCase() === '_blank' ? '_blank' : target,
          '',
        ]) as Window | null;
        if (!w) return;
        if (!isNew(w)) {
          navigate(w, href, { noreferrer, referrerPolicy });
          return;
        }
        whenJoined(w, () => navigate(w, href, { noreferrer, referrerPolicy }), { sever: noopener });
      });
    },
    true,
  );

  type Submission = { method: string; action: string; enctype: string; charset: string; data: FormData };

  /**
   * Posts (or gets) a form's data, as the form would have: from the blank window of ours itself
   * (`_self`, at this page's address), or — for a window of that name that was already open — from
   * this page, by the window's name (a form of ours, there only while it is sent; no event fires).
   */
  function submitTo(w: Window, target: string, submission: Submission): void {
    const blank = isBlank(w) && isOurs(w);
    const doc = blank ? asThisPage(w) : document;
    const form = doc.createElement('form');
    form.method = submission.method;
    form.action = submission.action;
    form.enctype = submission.enctype;
    form.target = blank ? '_self' : target;
    if (submission.charset) form.acceptCharset = submission.charset;
    for (const [key, value] of apply(formEntries, submission.data, []) as Iterable<[string, FormDataEntryValue]>) {
      const input = doc.createElement('input');
      input.name = key;
      if (typeof value === 'string') {
        input.type = 'hidden';
        input.value = value;
      } else {
        input.type = 'file';
        const files = new (doc.defaultView as unknown as { DataTransfer: typeof DataTransfer }).DataTransfer();
        files.items.add(value);
        input.files = files.files;
      }
      form.append(input);
    }
    (doc.body ?? doc.documentElement).append(form);
    apply(nativeSubmit, form, []);
    if (!blank) form.remove();
  }

  /** What a form submission sends, read now (the page may change the form right after). */
  function submissionOf(form: HTMLFormElement, submitter: HTMLElement | null): Submission | null {
    const own = (name: string) => (submitter?.hasAttribute(name) ? submitter : null) as HTMLButtonElement | null;
    const method = (own('formmethod')?.formMethod || form.method || 'get').toLowerCase();
    const action = own('formaction')?.formAction || form.action;
    if (method === 'dialog' || !/^https?:/i.test(action)) return null;
    let data: FormData;
    try {
      data = new NativeFormData(form, submitter ?? undefined);
    } catch {
      data = new NativeFormData(form);
    }
    return {
      method,
      action,
      enctype: own('formenctype')?.formEnctype || form.enctype,
      charset: form.acceptCharset,
      data,
    };
  }

  /** Sends a form into a window of the lane (or the browser would have sent it before joining). */
  function sendForm(target: string, submission: Submission): void {
    const w = apply(nativeOpen, window, ['', target, '']) as Window | null;
    if (!w) return;
    if (!isNew(w)) {
      submitTo(w, target, submission);
      return;
    }
    whenJoined(w, () => submitTo(w, target, submission), { post: submission.method === 'post' });
  }

  function formTarget(form: HTMLFormElement, submitter: HTMLElement | null): string {
    return submitter?.getAttribute('formtarget') ?? form.getAttribute('target') ?? baseTarget();
  }

  listen(
    window,
    'submit',
    (raw) => {
      const form = raw.target;
      if (!(form instanceof HTMLFormElement)) return;
      const submitter = (raw as SubmitEvent).submitter ?? null;
      const target = formTarget(form, submitter);
      const modified =
        submitter !== null &&
        modifiedSubmitter?.element === submitter &&
        Math.abs(raw.timeStamp - modifiedSubmitter.at) < 1000;
      if (!opensElsewhere(target) && !modified) return;
      afterPage(raw, () => {
        const submission = submissionOf(form, submitter);
        if (!submission) {
          // Not one to route (a dialog, a javascript: action): as the browser does it.
          apply(nativeSubmit, form, []);
          return;
        }
        sendForm(opensElsewhere(target) ? target : '_blank', submission);
      });
    },
    true,
  );

  // form.submit() fires no submit event: a form with a target goes the same way.
  try {
    HTMLFormElement.prototype.submit = {
      submit(this: HTMLFormElement) {
        const target = this instanceof HTMLFormElement ? formTarget(this, null) : '';
        const submission = target && opensElsewhere(target) ? submissionOf(this, null) : null;
        if (!submission) return apply(nativeSubmit, this, []) as void;
        sendForm(target, submission);
      },
    }.submit;
  } catch {
    // Leave it.
  }
}
