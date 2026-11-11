import type { SaveDecision } from '../core/decide';
import { detectIdentity, hasIdentity, isSpecificDetector, sameIdentity } from '../core/identity';
import { parseSessionExport } from '../core/session-import';
import type { Snapshot } from '../core/types';
import { SwapdeckError, type SaveOutcome } from '../shared/protocol';
import { readState } from '../shared/store';
import { findApp, persist, translatorFor } from './engine';
import { findAccount, pushHistory, update } from './state';

/**
 * Saves a sign-in exported by another tool (cookies, Playwright storage state; see
 * core/session-import.ts) as an account of the app: the account it belongs to when the sign-in
 * says who it is, else a new one — or `target`, refused when it is someone else. Nothing in the
 * browser changes: the account can then be switched to, or opened in a separate tab.
 */
export async function importSession(
  appId: string,
  text: string,
  target?: 'new' | string,
): Promise<SaveOutcome & { cookies: number; skipped: number }> {
  const state = await readState();
  const app = findApp(state, appId);
  const parsed = parseSessionExport(text, app);
  if (!parsed) throw new SwapdeckError('INVALID', 'import');
  const localStorage = app.storage.localStorage ? parsed.localStorage : undefined;
  if (!parsed.cookies.length && !localStorage) throw new SwapdeckError('NO_SESSION', 'import');

  const snapshot: Snapshot = {
    v: 1,
    capturedAt: Date.now(),
    origin: app.origin,
    cookies: app.storage.cookies ? parsed.cookies : [],
    storage: localStorage ? { localStorage } : {},
  };
  const identity = detectIdentity(app.detector, { cookies: parsed.cookies, localStorage: parsed.localStorage });
  if (identity) snapshot.identity = identity;
  const strong = identity?.confidence === 'strong' ? identity : null;
  const accounts = state.accounts.filter((account) => account.appId === app.id);

  let decision: Exclude<SaveDecision, { kind: 'skip' }>;
  if (target === 'new') {
    decision = { kind: 'new' };
  } else if (target) {
    const account = findAccount(state, target);
    if (account.appId !== app.id) throw new SwapdeckError('INVALID');
    if (hasIdentity(account) && strong && !sameIdentity(account, strong))
      throw new SwapdeckError('INVALID', 'identity');
    decision = { kind: 'existing', accountId: account.id };
  } else {
    // A site that says who is signed in, and nobody is: not a sign-in worth saving.
    if (!strong && isSpecificDetector(app.detector)) throw new SwapdeckError('NO_SESSION', 'signed-out');
    const owner = strong ? accounts.find((account) => sameIdentity(account, strong)) : undefined;
    decision = owner ? { kind: 'existing', accountId: owner.id } : { kind: 'new' };
  }

  const t = translatorFor(state.settings);
  const saved = await persist(
    app,
    { snapshot, identity, page: { origin: app.origin, href: '', title: '', contentType: '' } },
    decision,
    t,
  );
  await update((draft) => {
    const account = draft.accounts.find((item) => item.id === saved.accountId);
    pushHistory(draft, {
      kind: 'save',
      appId: app.id,
      appName: app.name,
      toId: saved.accountId,
      toLabel: account?.label,
      ok: true,
    });
  });
  return { ...saved, identity, cookies: parsed.cookies.length, skipped: parsed.skipped };
}
