import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { parseMenuId } from '../../src/background/menus';
import { rankAccounts } from '../../src/background/omnibox';
import { stagingCandidates } from '../../src/background/engine';
import { isTrackableUrl, recentFor, upsertRecent } from '../../src/background/watcher';
import { findPreset } from '../../src/core/presets';
import type { Account, AppDef } from '../../src/core/types';
import { createTranslator } from '../../src/i18n/translate';
import { parseRoute } from '../../src/options/router';
import { passphraseStrength } from '../../src/options/views/Security';
import { moveId } from '../../src/options/views/Apps';
import { AccountEditor } from '../../src/ui/AccountEditor';
import { errorText } from '../../src/ui/hooks';
import { I18nProvider } from '../../src/ui/i18n';

const supabase: AppDef = {
  ...findPreset('supabase')!,
  id: 'app_s',
  presetId: 'supabase',
  order: 0,
  createdAt: 0,
};

const account = (id: string, extra: Partial<Account> = {}): Account => ({
  id,
  appId: 'app_s',
  label: id,
  color: '#6d4cff',
  pins: [],
  recents: [],
  order: 0,
  createdAt: 0,
  switchCount: 0,
  ...extra,
});

describe('watcher helpers', () => {
  it('recognises Supabase projects and cleans their titles', () => {
    const url = 'https://supabase.com/dashboard/project/abcdefghijklmnopqrst/editor/123';
    expect(recentFor(supabase, url, 'Table Editor | orbit-prod | Supabase')).toMatchObject({
      key: 'abcdefghijklmnopqrst',
      title: 'orbit-prod',
      url: 'https://supabase.com/dashboard/project/abcdefghijklmnopqrst',
    });
    expect(recentFor(supabase, url, 'Supabase')?.title).toBe('abcdefghijklmnopqrst');
    expect(recentFor(supabase, 'https://supabase.com/dashboard/projects', 'x')).toBeNull();
  });

  it('keeps recent items unique, newest first, and keeps a known name', () => {
    const named = { key: 'k1', title: 'orbit', url: 'https://x/1', at: 1 };
    let list = upsertRecent([], named);
    list = upsertRecent(list, { key: 'k2', title: 'moni', url: 'https://x/2', at: 2 });
    list = upsertRecent(list, { key: 'k1', title: 'k1', url: 'https://x/1', at: 3 });
    expect(list.map((item) => [item.key, item.title])).toEqual([
      ['k1', 'orbit'],
      ['k2', 'moni'],
    ]);
    for (let i = 0; i < 10; i++) list = upsertRecent(list, { key: `n${i}`, title: `n${i}`, url: 'https://x', at: i });
    expect(list).toHaveLength(6);
  });

  it("tries the app's own switching page first, then static fallbacks", () => {
    expect(stagingCandidates(supabase)).toEqual([
      'https://supabase.com/robots.txt',
      'https://supabase.com/favicon.ico',
      'https://supabase.com/',
    ]);
  });

  it('does not remember sign-in pages or the switching page', () => {
    expect(isTrackableUrl(supabase, 'https://supabase.com/dashboard/project/abc')).toBe(true);
    expect(isTrackableUrl(supabase, 'https://supabase.com/dashboard/sign-in')).toBe(false);
    expect(isTrackableUrl(supabase, 'https://supabase.com/auth/callback?code=1')).toBe(false);
    expect(isTrackableUrl(supabase, 'https://supabase.com/robots.txt')).toBe(false);
  });
});

describe('menus, omnibox and routes', () => {
  it('parses context menu ids', () => {
    expect(parseMenuId('switch|app_s|acc_1')).toEqual({ kind: 'switch', appId: 'app_s', accountId: 'acc_1' });
    expect(parseMenuId('fresh|app_s')).toEqual({ kind: 'fresh', appId: 'app_s' });
    expect(parseMenuId('manage|app_s')).toEqual({ kind: 'manage', appId: 'app_s' });
    expect(parseMenuId('app|app_s')).toBeNull();
  });

  it('ranks accounts by name match, then recent use', () => {
    const accounts = [
      account('a', { label: 'Personal', email: 'me@x.co', lastUsedAt: 10 }),
      account('b', { label: 'Work', email: 'work@x.co', lastUsedAt: 5 }),
      account('c', { label: 'Client', email: 'c@work.io', lastUsedAt: 20 }),
    ];
    expect(rankAccounts([supabase], accounts, 'work').map((item) => item.account.id)).toEqual(['b', 'c']);
    expect(rankAccounts([supabase], accounts, 'supa').map((item) => item.account.id)).toEqual(['c', 'a', 'b']);
    expect(rankAccounts([], accounts, '')).toEqual([]);
  });

  it('parses manager routes', () => {
    expect(parseRoute('')).toEqual({ name: 'overview' });
    expect(parseRoute('#/apps/app_1')).toEqual({ name: 'app', id: 'app_1', tab: 'accounts' });
    expect(parseRoute('#/apps/app_1/settings')).toEqual({ name: 'app', id: 'app_1', tab: 'settings' });
    expect(parseRoute('#/add/custom?url=https%3A%2F%2Fx.io')).toEqual({ name: 'custom', url: 'https://x.io' });
    expect(parseRoute('#/nope')).toEqual({ name: 'overview' });
    expect(moveId(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
  });

  it('rates passphrases', () => {
    expect(passphraseStrength('short')).toBe(0);
    expect(passphraseStrength('longerpass')).toBe(1);
    expect(passphraseStrength('correct horse battery staple')).toBeGreaterThanOrEqual(2);
    expect(passphraseStrength('C0rrect-Horse-Battery!')).toBe(3);
  });
});

describe('errors', () => {
  const t = createTranslator('en');
  it('explains failures in words', () => {
    expect(errorText(t, { error: 'LOCKED' })).toMatch(/locked/i);
    expect(errorText(t, { error: 'INVALID', detail: 'overlap:Vercel' })).toContain('Vercel');
    expect(errorText(t, { error: 'BLOCKED_DOMAIN', detail: 'google.com' })).toContain('google.com');
    expect(errorText(t, { error: 'UNKNOWN', detail: 'boom' })).toContain('boom');
  });
});

describe('AccountEditor', () => {
  it('marks an account important only when the switch changes', async () => {
    const onSave = vi.fn();
    render(
      <I18nProvider language="en">
        <AccountEditor account={account('acc', { label: 'Prod' })} open onClose={() => undefined} onSave={onSave} />
      </I18nProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('switch', { name: 'Important account' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave.mock.calls[0]![0]).toMatchObject({ important: true });
    expect(onSave.mock.calls[0]![0].clear).not.toContain('important');
  });

  it('saves the edited fields and clears emptied ones', async () => {
    const onSave = vi.fn();
    render(
      <I18nProvider language="en">
        <AccountEditor
          account={account('acc', { label: 'Work', emoji: '💼', note: 'old', email: 'w@x.co' })}
          open
          onClose={() => undefined}
          onSave={onSave}
        />
      </I18nProvider>,
    );
    const user = userEvent.setup();
    const name = screen.getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Company');
    await user.click(screen.getByRole('radio', { name: 'Initials' }));
    await user.clear(screen.getByLabelText('Note'));
    await user.type(screen.getByLabelText(/Always open this page/), 'not a url');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.clear(screen.getByLabelText(/Always open this page/));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({
      label: 'Company',
      color: '#6d4cff',
      clear: ['icon', 'emoji', 'note', 'homeUrl'],
    });
  });
});
