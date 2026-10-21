import { fold } from './presets';
import type { Account, AppDef, Workspace } from './types';

/*
 * One search over everything the user switches between: workspaces, accounts
 * (by app, label, email or name) and apps. Accent-insensitive, every word must
 * match; names that start with a word rank first, then recent use.
 */

function words(query: string): string[] {
  return fold(query).split(/\s+/).filter(Boolean);
}

function score(label: string, haystack: string, terms: readonly string[], lastUsedAt = 0): number | null {
  if (!terms.every((term) => haystack.includes(term))) return null;
  const folded = fold(label);
  return (terms.some((term) => folded.startsWith(term)) ? 2 : 0) + lastUsedAt / 1e13;
}

export function rankAccounts(
  apps: readonly AppDef[],
  accounts: readonly Account[],
  query: string,
): { app: AppDef; account: Account }[] {
  const terms = words(query);
  const results: { app: AppDef; account: Account; score: number }[] = [];
  for (const account of accounts) {
    const app = apps.find((item) => item.id === account.appId);
    if (!app) continue;
    const haystack = fold(
      [app.name, account.label, account.email ?? '', account.name ?? '', account.note ?? ''].join(' '),
    );
    const value = score(account.label, haystack, terms, account.lastUsedAt);
    if (value !== null) results.push({ app, account, score: value });
  }
  return results.sort((a, b) => b.score - a.score).map(({ app, account }) => ({ app, account }));
}

export function rankWorkspaces(workspaces: readonly Workspace[], query: string): Workspace[] {
  const terms = words(query);
  if (!terms.length) return [];
  return workspaces
    .map((workspace) => ({
      workspace,
      score: score(workspace.name, fold([workspace.name, workspace.note ?? ''].join(' ')), terms, workspace.lastUsedAt),
    }))
    .filter((item): item is { workspace: Workspace; score: number } => item.score !== null)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.workspace);
}

export function rankApps(apps: readonly AppDef[], query: string): AppDef[] {
  const terms = words(query);
  if (!terms.length) return [...apps];
  return apps
    .map((app) => ({ app, score: score(app.name, fold([app.name, ...app.domains].join(' ')), terms) }))
    .filter((item): item is { app: AppDef; score: number } => item.score !== null)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.app);
}
