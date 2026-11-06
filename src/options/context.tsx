import { createContext, use } from 'react';
import type { ErrorCode, RequestType, ResponseOf, send } from '../shared/protocol';
import type { Snapshot } from '../ui/hooks';

export type Run = <T extends RequestType>(
  type: T,
  payload: Parameters<typeof send<T>>[1],
  key?: string,
) => Promise<ResponseOf<T> | null>;

export type Manager = {
  data: Snapshot;
  run: Run;
  pending: string | null;
  /** The last failed request's error code, for views that react to e.g. LOCKED. */
  lastError: ErrorCode | null;
  /**
   * Resolves true at once when saved sessions are readable; otherwise asks for the
   * passphrase in a dialog and resolves true once unlocked, false if the user gives up.
   */
  requireUnlock: () => Promise<boolean>;
};

export const ManagerContext = createContext<Manager | null>(null);

export function useManager(): Manager {
  const value = use(ManagerContext);
  if (!value) throw new Error('useManager outside ManagerContext');
  return value;
}
