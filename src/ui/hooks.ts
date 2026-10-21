import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import type { Accent, ThemePreference } from '../core/types';
import { isMessageKey, type Translate } from '../i18n/translate';
import { send, type ErrorCode, type RequestType, type ResponseOf, type Result } from '../shared/protocol';
import { readSessionInfo, readState, subscribe, type SessionInfo, type State } from '../shared/store';

export type Snapshot = { state: State } & SessionInfo;

/** The extension state, kept current through chrome.storage change events. */
export function useSwapdeck(): Snapshot | null {
  const [data, setData] = useState<Snapshot | null>(null);
  useEffect(() => {
    let alive = true;
    let state: State | null = null;
    let session: SessionInfo | null = null;
    const publish = () => {
      if (alive && state && session) setData({ state, ...session });
    };
    const loadState = () =>
      readState().then((value) => {
        state = value;
        publish();
      });
    const loadSession = () =>
      readSessionInfo().then((value) => {
        session = value;
        publish();
      });
    void loadState();
    void loadSession();
    const unsubscribe = subscribe(
      () => void loadState(),
      () => void loadSession(),
    );
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);
  return data;
}

/**
 * Applies the theme and accent preferences to <html data-theme data-accent>,
 * before the browser paints: content that appears with the settings is drawn in
 * its final colors at once (no flash, no color transition from the other theme).
 */
export function useTheme(theme: ThemePreference | undefined, accent?: Accent): void {
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (!theme || theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = theme;
    if (!accent || accent === 'son') delete root.dataset.accent;
    else root.dataset.accent = accent;
  }, [theme, accent]);
}

/** A readable message for a failed request. */
export function errorText(t: Translate, result: { error: ErrorCode; detail?: string }): string {
  const { error, detail } = result;
  if (error === 'INVALID' && detail) {
    const [kind, value] = detail.split(':');
    const key = `error.INVALID.${kind}`;
    if (isMessageKey(key)) return t(key, { app: value ?? '' });
  }
  if (error === 'BLOCKED_DOMAIN') return t('error.BLOCKED_DOMAIN', { domain: detail ?? '' });
  const key = `error.${error}`;
  if (error === 'UNKNOWN' || !isMessageKey(key)) return t('error.UNKNOWN', { detail: detail ?? error });
  return t(key);
}

/**
 * Wraps `send` for components: tracks which request is running and reports
 * failures through `onError`.
 */
export function useAction(
  onError: (message: string, result: { error: ErrorCode; detail?: string }) => void,
  t: Translate,
) {
  const [pending, setPending] = useState<string | null>(null);
  const run = useCallback(
    async <T extends RequestType>(
      type: T,
      payload: Parameters<typeof send<T>>[1],
      key: string = type,
    ): Promise<ResponseOf<T> | null> => {
      setPending(key);
      try {
        const result: Result<ResponseOf<T>> = await send(type, payload);
        if (result.ok) return result.data;
        onError(errorText(t, result), result);
        return null;
      } finally {
        setPending((current) => (current === key ? null : current));
      }
    },
    [onError, t],
  );
  return { run, pending };
}
