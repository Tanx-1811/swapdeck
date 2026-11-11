import { detectIdentity, hasIdentity, isSpecificDetector, sameIdentity } from './identity';
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
    if (active && sameIdentity(active, identity)) return { kind: 'active', accountId: active.id };
    // Someone already saved under their own account goes there, even when the account in use
    // doesn't know who it is yet (it would otherwise take over their session and identity).
    const owner = accounts.find((account) => sameIdentity(account, identity));
    if (owner) return { kind: 'existing', accountId: owner.id };
    if (active && !hasIdentity(active)) return { kind: 'active', accountId: active.id };
    return { kind: 'new' };
  }

  // A reliable detector that finds nobody means the site is signed out:
  // saving now would overwrite a good session with a signed-out one.
  if (isSpecificDetector(detector)) return { kind: 'skip', reason: 'signed-out' };
  return active ? { kind: 'active', accountId: active.id } : { kind: 'new' };
}

/**
 * Whether a session that comes from elsewhere (a backup, a file someone sent) may be saved into an
 * account: never when it provably is someone else's, nor when a reliable detector finds nobody
 * signed in there. What can't be told apart is allowed, as `decideSave` allows it.
 */
export function sessionFitsAccount(
  account: Pick<Account, 'identityId' | 'email' | 'name'>,
  snapshot: Pick<Snapshot, 'cookies' | 'storage'>,
  detector: DetectorSpec,
): boolean {
  const identity = detectIdentity(detector, {
    cookies: snapshot.cookies,
    localStorage: snapshot.storage.localStorage,
  });
  if (identity?.confidence === 'strong') return !hasIdentity(account) || sameIdentity(account, identity);
  return !isSpecificDetector(detector);
}

/** The account after `currentId` in display order, wrapping around. */
export function cycleAccount(accounts: readonly Account[], currentId: string | null | undefined, step: 1 | -1) {
  // Only accounts with a saved sign-in can be switched to; the current one keeps its place in the round.
  const sorted = accounts
    .filter((account) => account.capturedAt || account.id === currentId)
    .sort((a, b) => a.order - b.order);
  if (sorted.length === 0) return null;
  const index = sorted.findIndex((account) => account.id === currentId);
  if (index === -1) return sorted[step === 1 ? 0 : sorted.length - 1]!;
  const next = sorted[(index + step + sorted.length) % sorted.length]!;
  return next.id === currentId ? null : next;
}
