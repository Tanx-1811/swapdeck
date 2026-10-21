import type { Account, ActiveMap, AppDef, Workspace } from './types';
import { ACCOUNT_COLORS } from './util';

export type WorkspaceStatus = {
  /** Members whose account is the one in use. */
  matched: number;
  /** Members that still point at an existing app and account. */
  total: number;
  state: 'active' | 'partial' | 'inactive' | 'empty';
};

/** Members of a workspace that still exist, in the apps' display order. */
export function liveMembers(
  workspace: Pick<Workspace, 'members'>,
  apps: readonly Pick<AppDef, 'id'>[],
  accounts: readonly Pick<Account, 'id' | 'appId'>[],
): [string, string][] {
  return apps.flatMap((app): [string, string][] => {
    const accountId = workspace.members[app.id];
    if (!accountId) return [];
    return accounts.some((account) => account.id === accountId && account.appId === app.id)
      ? [[app.id, accountId]]
      : [];
  });
}

/** The important accounts a workspace switch would move to ("app: account"), skipping those already in use. */
export function importantTargets(
  workspace: Pick<Workspace, 'members'>,
  apps: readonly Pick<AppDef, 'id' | 'name'>[],
  accounts: readonly Pick<Account, 'id' | 'appId' | 'label' | 'important'>[],
  active: ActiveMap,
): string[] {
  return liveMembers(workspace, apps, accounts).flatMap(([appId, accountId]) => {
    const account = accounts.find((item) => item.id === accountId);
    if (!account?.important || active[appId] === accountId) return [];
    return [`${apps.find((app) => app.id === appId)?.name ?? appId}: ${account.label}`];
  });
}

export function workspaceStatus(
  workspace: Pick<Workspace, 'members'>,
  apps: readonly Pick<AppDef, 'id'>[],
  accounts: readonly Pick<Account, 'id' | 'appId'>[],
  active: ActiveMap,
): WorkspaceStatus {
  const members = liveMembers(workspace, apps, accounts);
  const matched = members.filter(([appId, accountId]) => active[appId] === accountId).length;
  const total = members.length;
  const state = total === 0 ? 'empty' : matched === total ? 'active' : matched > 0 ? 'partial' : 'inactive';
  return { matched, total, state };
}

/** The workspaces whose every account is in use right now. */
export function activeWorkspaces<T extends Pick<Workspace, 'members'>>(
  workspaces: readonly T[],
  apps: readonly Pick<AppDef, 'id'>[],
  accounts: readonly Pick<Account, 'id' | 'appId'>[],
  active: ActiveMap,
): T[] {
  return workspaces.filter((workspace) => workspaceStatus(workspace, apps, accounts, active).state === 'active');
}

/** Free email providers: their accounts belong to a person, not a company. */
export const PERSONAL_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'yahoo.com.vn',
  'icloud.com',
  'me.com',
  'proton.me',
  'protonmail.com',
  'aol.com',
  'gmx.com',
  'zoho.com',
  'yandex.com',
]);

export type WorkspaceSuggestion = {
  /** The email domain, or "personal" for free email providers. */
  key: string;
  name: string;
  color: string;
  members: Record<string, string>;
};

function nameFromDomain(domain: string): string {
  const base = domain.split('.')[0] ?? domain;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/**
 * Suggests workspaces by grouping accounts on their email domain (everyone at
 * acme.io works for Acme; free email providers form "Personal"). A suggestion
 * needs accounts on two or more apps, and isn't offered when a workspace already
 * holds the same accounts or two or more accounts of that domain.
 * Per app, the most recently used account of the group is chosen.
 */
export function suggestWorkspaces(
  apps: readonly Pick<AppDef, 'id'>[],
  accounts: readonly Account[],
  workspaces: readonly Pick<Workspace, 'members'>[],
  personalName: string,
): WorkspaceSuggestion[] {
  const appIds = new Set(apps.map((app) => app.id));
  const groups = new Map<string, Map<string, Account>>();
  for (const account of accounts) {
    if (!account.email || !appIds.has(account.appId)) continue;
    const domain = account.email.split('@')[1]?.toLowerCase();
    if (!domain) continue;
    const key = PERSONAL_EMAIL_DOMAINS.has(domain) ? 'personal' : domain;
    const group = groups.get(key) ?? new Map<string, Account>();
    const current = group.get(account.appId);
    if (!current || (account.lastUsedAt ?? 0) > (current.lastUsedAt ?? 0)) group.set(account.appId, account);
    groups.set(key, group);
  }
  const keyOf = (account: Account | undefined) => {
    const domain = account?.email?.split('@')[1]?.toLowerCase();
    if (!domain) return null;
    return PERSONAL_EMAIL_DOMAINS.has(domain) ? 'personal' : domain;
  };
  // A domain already has a workspace when one holds two or more of its accounts.
  const taken = new Set<string>();
  for (const workspace of workspaces) {
    const counts = new Map<string, number>();
    for (const accountId of Object.values(workspace.members)) {
      const key = keyOf(accounts.find((account) => account.id === accountId));
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const [key, count] of counts) if (count >= 2) taken.add(key);
  }
  const existing = workspaces.map((workspace) => JSON.stringify(Object.entries(workspace.members).sort()));
  const suggestions: WorkspaceSuggestion[] = [];
  let colorIndex = 0;
  for (const [key, group] of groups) {
    if (group.size < 2 || taken.has(key)) continue;
    const members = Object.fromEntries([...group].map(([appId, account]) => [appId, account.id]));
    const covered = workspaces.some((workspace) =>
      Object.entries(members).every(([appId, accountId]) => workspace.members[appId] === accountId),
    );
    if (covered || existing.includes(JSON.stringify(Object.entries(members).sort()))) continue;
    suggestions.push({
      key,
      name: key === 'personal' ? personalName : nameFromDomain(key),
      color: ACCOUNT_COLORS[colorIndex++ % ACCOUNT_COLORS.length]!,
      members,
    });
  }
  return suggestions.sort((a, b) => Object.keys(b.members).length - Object.keys(a.members).length);
}

/** Drops members pointing at apps or accounts that no longer exist. */
export function pruneMembers(
  members: Record<string, string>,
  accounts: readonly Pick<Account, 'id' | 'appId'>[],
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(members).filter(([appId, accountId]) =>
      accounts.some((account) => account.id === accountId && account.appId === appId),
    ),
  );
}

type GroupColor = `${chrome.tabGroups.Color}`;

const GROUP_COLORS: [GroupColor, [number, number, number]][] = [
  ['grey', [95, 99, 104]],
  ['blue', [26, 115, 232]],
  ['red', [217, 48, 37]],
  ['yellow', [249, 171, 0]],
  ['green', [24, 128, 56]],
  ['pink', [208, 24, 132]],
  ['purple', [161, 66, 244]],
  ['cyan', [0, 123, 131]],
  ['orange', [250, 144, 62]],
];

/** The Chrome tab group color closest to a hex color. */
export function tabGroupColor(hex: string): GroupColor {
  const rgb = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
  if (rgb.some(Number.isNaN)) return 'grey';
  let best: GroupColor = 'grey';
  let bestDistance = Infinity;
  for (const [name, [r, g, b]] of GROUP_COLORS) {
    const distance = (rgb[0]! - r) ** 2 + (rgb[1]! - g) ** 2 + (rgb[2]! - b) ** 2;
    if (distance < bestDistance) {
      best = name;
      bestDistance = distance;
    }
  }
  return best;
}
