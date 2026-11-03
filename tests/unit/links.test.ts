import { describe, expect, it } from 'vitest';
import { cleanLinkRules, linkOwner, normalizeLinkRule, recentKey, ruleScore } from '../../src/core/links';
import type { Account, RecentItem } from '../../src/core/types';

const supabase = {
  recentPattern: '^/dashboard/project/([a-z0-9]{20})',
  homeUrl: 'https://supabase.com/dashboard/projects',
  loginUrl: 'https://supabase.com/dashboard/sign-in',
};
const plain = { homeUrl: 'https://acme.example/', loginUrl: 'https://acme.example/login' };
const REF_A = 'abcdefghijklmnopqrst';
const REF_B = 'bbbbbbbbbbbbbbbbbbbb';

const recent = (key: string): RecentItem => ({
  key,
  title: key,
  url: `https://supabase.com/dashboard/project/${key}`,
  at: 1,
});
const account = (id: string, extra: Partial<Account> = {}) => ({
  id,
  pins: [] as Account['pins'],
  recents: [] as RecentItem[],
  ...extra,
});

describe('link rules', () => {
  it('normalises a site or page the way Swapdeck Desktop does', () => {
    expect(normalizeLinkRule('https://www.Acme.example/Admin/?tab=1#top')).toBe('acme.example/Admin');
    expect(normalizeLinkRule('  *.acme.example  ')).toBe('acme.example');
    expect(normalizeLinkRule('me@acme.example:8443/x/')).toBe('acme.example/x');
    expect(normalizeLinkRule('supabase.com/dashboard/project/abcd')).toBe('supabase.com/dashboard/project/abcd');
    for (const bad of ['', 'localhost', 'not a site', '.acme.example', 'acme.example.', 'ác.vn']) {
      expect(normalizeLinkRule(bad), bad).toBeNull();
    }
    expect(
      cleanLinkRules(['acme.example', 'https://acme.example/', 42, 'nope', ...Array(30).fill('x.example/y')]),
    ).toEqual(['acme.example', 'x.example/y']);
  });

  it('matches subdomains and whole path segments, the most specific highest', () => {
    expect(ruleScore('acme.example', 'https://app.acme.example/x')).toBeGreaterThan(0);
    expect(ruleScore('acme.example', 'https://acmeexample.com/')).toBe(-1);
    expect(
      ruleScore('supabase.com/dashboard/project/abc', 'https://supabase.com/dashboard/project/abc/editor'),
    ).toBeGreaterThan(0);
    expect(ruleScore('supabase.com/dashboard/project/abc', 'https://supabase.com/dashboard/project/abcd')).toBe(-1);
    expect(ruleScore('supabase.com/dashboard', 'https://supabase.com/dashboard/x')).toBeGreaterThan(
      ruleScore('supabase.com', 'https://supabase.com/dashboard/x'),
    );
    expect(ruleScore('acme.example', 'https://acme.example/')).toBeGreaterThan(
      ruleScore('acme.example', 'https://app.acme.example/'),
    );
    expect(ruleScore('acme.example', 'ftp://acme.example/')).toBe(-1);
  });

  it('reads the recent item key of a page', () => {
    expect(recentKey(supabase, `https://supabase.com/dashboard/project/${REF_A}/editor`)).toBe(REF_A);
    expect(recentKey(supabase, 'https://supabase.com/dashboard/projects')).toBeNull();
    expect(recentKey({ recentPattern: '([' }, 'https://x.example/')).toBeNull();
    expect(recentKey({}, 'https://acme.example/a')).toBeNull();
  });
});

describe('the account a page belongs to', () => {
  const url = `https://supabase.com/dashboard/project/${REF_A}/editor`;

  it('follows the most specific rule, unless it is the account in use', () => {
    const accounts = [
      account('acc_a', { linkRules: ['supabase.com'] }),
      account('acc_b', { linkRules: [`supabase.com/dashboard/project/${REF_A}`] }),
    ];
    expect(linkOwner(supabase, accounts, url, 'acc_a')).toEqual({
      accountId: 'acc_b',
      why: 'rule',
      match: `supabase.com/dashboard/project/${REF_A}`,
    });
    expect(linkOwner(supabase, accounts, url, 'acc_b')).toBeNull();
    // Two accounts with the same rule: can't tell.
    const tie = [account('acc_a', { linkRules: ['acme.example'] }), account('acc_b', { linkRules: ['acme.example'] })];
    expect(linkOwner(plain, tie, 'https://acme.example/x', null)).toBeNull();
  });

  it('learns from recent items: the only account that opened it', () => {
    const accounts = [account('acc_a', { recents: [recent(REF_B)] }), account('acc_b', { recents: [recent(REF_A)] })];
    expect(linkOwner(supabase, accounts, url, 'acc_a')).toEqual({ accountId: 'acc_b', why: 'recent', match: REF_A });
    // The account in use opened it too, or nobody did: nothing to do.
    expect(linkOwner(supabase, accounts, url, 'acc_b')).toBeNull();
    expect(linkOwner(supabase, accounts, 'https://supabase.com/dashboard/projects', 'acc_a')).toBeNull();
    const shared = [...accounts, account('acc_c', { recents: [recent(REF_A)] })];
    expect(linkOwner(supabase, shared, url, 'acc_a')).toBeNull();
  });

  it('learns from pinned pages, but not from the home or sign-in page', () => {
    const pin = (address: string) => [{ id: 'p', title: 'x', url: address }];
    const accounts = [
      account('acc_a', { pins: pin('https://acme.example/') }),
      account('acc_b', { pins: pin('https://acme.example/team/blue') }),
      account('acc_c', { pins: pin('https://acme.example/login') }),
    ];
    expect(linkOwner(plain, accounts, 'https://acme.example/team/blue/settings', 'acc_a')).toMatchObject({
      accountId: 'acc_b',
      why: 'pin',
    });
    expect(linkOwner(plain, accounts, 'https://acme.example/team/bluer', 'acc_a')).toBeNull();
    expect(linkOwner(plain, accounts, 'https://acme.example/login', 'acc_b')).toBeNull();
    // With recent items, a pin counts by its item.
    const pinned = [
      account('acc_a'),
      account('acc_b', { pins: pin(`https://supabase.com/dashboard/project/${REF_A}`) }),
    ];
    expect(linkOwner(supabase, pinned, url, 'acc_a')).toMatchObject({ accountId: 'acc_b', why: 'pin', match: REF_A });
    expect(linkOwner(supabase, pinned, `https://supabase.com/dashboard/project/${REF_B}`, 'acc_a')).toBeNull();
  });
});
