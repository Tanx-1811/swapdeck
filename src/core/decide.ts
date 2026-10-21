import { hasIdentity, isSpecificDetector, sameIdentity } from './identity';
import type { Account, DetectorSpec, Identity, Snapshot } from './types';

/** Where the live session should be saved before it is replaced. */
export type SaveDecision =
  | { kind: 'skip'; reason: 'empty' | 'signed-out' }
  /** The live session belongs to the active account (or can't be told apart from it). */
  | { kind: 'active'; accountId: string }
  /** The live session belongs to another saved account (the user signed in by hand). */
  | { kind: 'existing'; accountId: string }
  /** Nobody saved is signed in: keep the session as a new account rather than lose it. */
  | { kind: 'new' };

export function isEmptySnapshot(snapshot: Pick<Snapshot, 'cookies' | 'storage'>): boolean {
  const { localStorage, sessionStorage, indexedDB } = snapshot.storage;
  return (
    snapshot.cookies.length === 0 &&
    Object.keys(localStorage ?? {}).length === 0 &&
    Object.keys(sessionStorage ?? {}).length === 0 &&
    (indexedDB ?? []).length === 0
  );
}

/**
 * Decides which account the live session is saved into. The rule that matters:
 * a session is never written into an account it provably doesn't belong to, and
 * a signed-in session nobody saved yet is never thrown away.
 */
export function decideSave(options: {
  accounts: readonly Account[];
  activeId: string | null | undefined;
  detector: DetectorSpec;
  identity: Identity | null;
  empty: boolean;
}): SaveDecision {
  const { accounts, activeId, detector, identity, empty } = options;
  if (empty) return { kind: 'skip', reason: 'empty' };
  const active = activeId ? accounts.find((account) => account.id === activeId) : undefined;

  if (identity && identity.confidence === 'strong') {
    if (active && (sameIdentity(active, identity) || !hasIdentity(active))) {
      return { kind: 'active', accountId: active.id };
    }
    const owner = accounts.find((account) => sameIdentity(account, identity));
    if (owner) return { kind: 'existing', accountId: owner.id };
    return { kind: 'new' };
  }

  // A reliable detector that finds nobody means the site is signed out:
  // saving now would overwrite a good session with a signed-out one.
  if (isSpecificDetector(detector)) return { kind: 'skip', reason: 'signed-out' };
  return active ? { kind: 'active', accountId: active.id } : { kind: 'new' };
}

/** The account after `currentId` in display order, wrapping around. */
export function cycleAccount(accounts: readonly Account[], currentId: string | null | undefined, step: 1 | -1) {
  const sorted = [...accounts].sort((a, b) => a.order - b.order);
  if (sorted.length === 0) return null;
  const index = sorted.findIndex((account) => account.id === currentId);
  if (index === -1) return sorted[step === 1 ? 0 : sorted.length - 1]!;
  return sorted[(index + step + sorted.length) % sorted.length]!;
}
