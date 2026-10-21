import { describe, expect, it } from 'vitest';
import { rankAccounts, rankApps, rankWorkspaces } from '../../src/core/search';
import type { Account, AppDef, Workspace } from '../../src/core/types';
import {
  activeWorkspaces,
  importantTargets,
  liveMembers,
  pruneMembers,
  suggestWorkspaces,
  tabGroupColor,
  workspaceStatus,
} from '../../src/core/workspaces';

const apps = ['supabase', 'vercel', 'github'].map((id, order) => ({
  id,
  name: id[0]!.toUpperCase() + id.slice(1),
  domains: [`${id}.com`],
  order,
})) as unknown as AppDef[];
const account = (id: string, appId: string, extra: Partial<Account> = {}): Account => ({
  id,
  appId,
  label: id,
  color: '#6d4cff',
  pins: [],
  recents: [],
  order: 0,
  createdAt: 0,
  switchCount: 0,
  ...extra,
});
const accounts = [
  account('s_acme', 'supabase', { email: 'an@acme.example', lastUsedAt: 5 }),
  account('s_acme2', 'supabase', { email: 'ops@acme.example', lastUsedAt: 9 }),
  account('v_acme', 'vercel', { email: 'an@acme.example' }),
  account('g_me', 'github', { email: 'an@gmail.com' }),
  account('s_me', 'supabase', { email: 'an@gmail.com' }),
  account('v_solo', 'vercel', { email: 'x@solo.dev' }),
];
const workspace = (id: string, members: Record<string, string>, extra: Partial<Workspace> = {}): Workspace => ({
  id,
  name: id,
  color: '#6d4cff',
  members,
  links: [],
  order: 0,
  createdAt: 0,
  switchCount: 0,
  ...extra,
});

describe('workspace status', () => {
  const acme = workspace('acme', { supabase: 's_acme', vercel: 'v_acme', gone: 'x', github: 'missing' });
  it('counts only members that still exist', () => {
    expect(liveMembers(acme, apps, accounts)).toEqual([
      ['supabase', 's_acme'],
      ['vercel', 'v_acme'],
    ]);
    expect(pruneMembers(acme.members, accounts)).toEqual({ supabase: 's_acme', vercel: 'v_acme' });
  });

  it('is active, partial, inactive or empty', () => {
    expect(workspaceStatus(acme, apps, accounts, { supabase: 's_acme', vercel: 'v_acme' })).toEqual({
      matched: 2,
      total: 2,
      state: 'active',
    });
    expect(workspaceStatus(acme, apps, accounts, { supabase: 's_acme' }).state).toBe('partial');
    expect(workspaceStatus(acme, apps, accounts, {}).state).toBe('inactive');
    expect(workspaceStatus(workspace('none', {}), apps, accounts, {}).state).toBe('empty');
    expect(activeWorkspaces([acme], apps, accounts, { supabase: 's_acme', vercel: 'v_acme' })).toEqual([acme]);
  });
});

describe('important accounts', () => {
  it('lists the important accounts a switch would move to, not those already in use', () => {
    const list = [
      account('s_prod', 'supabase', { label: 'Prod', important: true }),
      account('v_prod', 'vercel', { label: 'Team', important: true }),
      account('g_me', 'github'),
    ];
    const ws = workspace('ws', { supabase: 's_prod', vercel: 'v_prod', github: 'g_me', gone: 'x' });
    expect(importantTargets(ws, apps, list, {})).toEqual(['Supabase: Prod', 'Vercel: Team']);
    expect(importantTargets(ws, apps, list, { vercel: 'v_prod' })).toEqual(['Supabase: Prod']);
    expect(importantTargets(workspace('none', { github: 'g_me' }), apps, list, {})).toEqual([]);
  });
});

describe('suggestions', () => {
  it('groups accounts by email domain across apps, picking the most recent per app', () => {
    const suggestions = suggestWorkspaces(apps, accounts, [], 'Personal');
    expect(suggestions.map((item) => [item.key, item.name, item.members])).toEqual([
      ['acme.example', 'Acme', { supabase: 's_acme2', vercel: 'v_acme' }],
      ['personal', 'Personal', { github: 'g_me', supabase: 's_me' }],
    ]);
  });

  it('skips groups already covered by a workspace', () => {
    const existing = workspace('acme', { supabase: 's_acme2', vercel: 'v_acme', github: 'g_me' });
    expect(suggestWorkspaces(apps, accounts, [existing], 'Personal').map((item) => item.key)).toEqual(['personal']);
  });

  it('skips domains that already have a workspace with other accounts of theirs', () => {
    const existing = workspace('acme', { supabase: 's_acme', vercel: 'v_acme' });
    expect(suggestWorkspaces(apps, accounts, [existing], 'Personal').map((item) => item.key)).toEqual(['personal']);
  });
});

describe('search', () => {
  it('finds workspaces, accounts and apps without accents', () => {
    const list = [workspace('w1', {}, { name: 'Khách hàng Acme' }), workspace('w2', {}, { name: 'Cá nhân' })];
    expect(rankWorkspaces(list, 'khach').map((item) => item.id)).toEqual(['w1']);
    expect(rankWorkspaces(list, '')).toEqual([]);
    expect(rankAccounts(apps, accounts, 'acme vercel').map((item) => item.account.id)).toEqual(['v_acme']);
    expect(rankApps(apps, 'git').map((app) => app.id)).toEqual(['github']);
    expect(rankApps(apps, '')).toHaveLength(3);
  });
});

describe('tab group colors', () => {
  it('picks the nearest Chrome group color', () => {
    expect(tabGroupColor('#1f6fde')).toBe('blue');
    expect(tabGroupColor('#0b7f58')).toBe('green');
    expect(tabGroupColor('#c2255c')).toBe('pink');
    expect(tabGroupColor('nope')).toBe('grey');
  });
});
