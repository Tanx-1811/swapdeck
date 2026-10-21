import { describe, expect, it } from 'vitest';
import { appForUrl, hostMatchesDomain, normalizeDomain } from '../../src/core/domains';
import { findPreset, fold, isBlockedDomain, presetForUrl, PRESETS, searchPresets } from '../../src/core/presets';
import { sanitizeApp } from '../../src/core/validate';
import { en } from '../../src/i18n/en';
import {
  createTranslator,
  formatMessage,
  isMessageKey,
  relativeTime,
  resolveLanguage,
  formatBytes,
} from '../../src/i18n/translate';
import { vi as vietnamese } from '../../src/i18n/vi';
import { customAppFromUrl, presetToInput } from '../../src/shared/apps';

describe('presets', () => {
  it('are unique, valid apps whose main address belongs to their domains', () => {
    const ids = new Set<string>();
    for (const preset of PRESETS) {
      expect(ids.has(preset.id), preset.id).toBe(false);
      ids.add(preset.id);
      const app = sanitizeApp({ ...presetToInput(preset), id: `app_${preset.id}`, order: 0, createdAt: 0 });
      expect(app, preset.id).not.toBeNull();
      expect(app!.domains, preset.id).toEqual(preset.domains);
      expect(appForUrl([preset], preset.origin), preset.id).toBe(preset);
      expect(appForUrl([preset], preset.homeUrl), preset.id).toBe(preset);
      for (const domain of preset.domains) expect(normalizeDomain(domain), preset.id).toBe(domain);
      expect(isBlockedDomain(preset.domains[0]!), preset.id).toBe(false);
    }
  });

  it('never share a domain between two presets', () => {
    for (const a of PRESETS) {
      for (const b of PRESETS) {
        if (a === b) continue;
        const clash = a.domains.some((x) => b.domains.some((y) => hostMatchesDomain(x, y)));
        expect(clash, `${a.id} / ${b.id}`).toBe(false);
      }
    }
  });

  it('start with Supabase and know its dashboard storage', () => {
    expect(PRESETS[0]!.id).toBe('supabase');
    expect(PRESETS[0]!.detector).toMatchObject({ kind: 'localStorage' });
    expect(presetForUrl('https://supabase.com/dashboard/project/abc')?.id).toBe('supabase');
    expect(findPreset('github')?.name).toBe('GitHub');
  });

  it('search by name, domain and Vietnamese keywords without accents', () => {
    expect(searchPresets('supa').map((preset) => preset.id)).toEqual(['supabase']);
    expect(searchPresets('co so du lieu').map((preset) => preset.id)).toContain('supabase');
    expect(searchPresets('mua sam').map((preset) => preset.id)).toContain('shopee');
    expect(searchPresets('').length).toBe(PRESETS.length);
    expect(fold('Đăng Nhập')).toBe('dang nhap');
  });

  it('block sites whose sign-in Chrome itself uses', () => {
    expect(isBlockedDomain('accounts.google.com')).toBe(true);
    expect(isBlockedDomain('youtube.com')).toBe(true);
    expect(isBlockedDomain('googleusercontent.example')).toBe(false);
  });
});

describe('custom apps', () => {
  it('suggests an app from any URL', () => {
    expect(customAppFromUrl('https://app.moni.vn/dashboard?x=1')).toMatchObject({
      name: 'Moni',
      domains: ['moni.vn'],
      origin: 'https://app.moni.vn',
      homeUrl: 'https://app.moni.vn/dashboard',
      detector: { kind: 'auto' },
    });
    expect(customAppFromUrl('my-app.vercel.app')).toMatchObject({
      domains: ['my-app.vercel.app'],
      origin: 'https://my-app.vercel.app',
    });
    expect(customAppFromUrl('http://localhost:5173/')).toMatchObject({
      domains: ['localhost'],
      origin: 'http://localhost:5173',
    });
    expect(customAppFromUrl('::::')).toBeNull();
  });
});

describe('i18n', () => {
  it('has every English key in Vietnamese, with the same placeholders', () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      const english = en[key];
      const translated = vietnamese[key];
      expect(translated, key).toBeTruthy();
      const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
      expect(placeholders(translated), key).toEqual(placeholders(english));
    }
    expect(Object.keys(vietnamese).sort()).toEqual(Object.keys(en).sort());
  });

  it('resolves the language and formats messages', () => {
    expect(resolveLanguage('auto', 'vi-VN')).toBe('vi');
    expect(resolveLanguage('auto', 'en-GB')).toBe('en');
    expect(resolveLanguage('en', 'vi')).toBe('en');
    expect(formatMessage('{a} and {b}', { a: 1 })).toBe('1 and {b}');
    expect(createTranslator('vi')('common.save')).toBe('Lưu');
    expect(isMessageKey('common.save')).toBe(true);
    expect(isMessageKey('nope.nope')).toBe(false);
  });

  it('formats relative times and sizes', () => {
    const now = Date.UTC(2026, 9, 19, 12);
    expect(relativeTime(now - 5_000, 'en', now)).toBe('now');
    expect(relativeTime(now - 3 * 60_000, 'en', now)).toBe('3 minutes ago');
    expect(relativeTime(now - 2 * 3600_000, 'vi', now)).toBe('2 giờ trước');
    expect(relativeTime(now - 86400_000, 'en', now)).toBe('yesterday');
    expect(formatBytes(512, 'en')).toBe('512 B');
    expect(formatBytes(1536, 'en')).toBe('1.5 KB');
    expect(formatBytes(1536, 'vi')).toBe('1,5 KB');
  });
});
