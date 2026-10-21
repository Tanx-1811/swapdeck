import { normalizeDomain, parseHttpUrl, registrableDomain } from '../core/domains';
import type { Preset } from '../core/presets';
import type { AppDef } from '../core/types';
import type { AppInput } from './protocol';

export function presetToInput(preset: Preset): AppInput {
  const input: AppInput = {
    presetId: preset.id,
    name: preset.name,
    color: preset.color,
    domains: [...preset.domains],
    origin: preset.origin,
    homeUrl: preset.homeUrl,
    stagingPath: preset.stagingPath,
    storage: { ...preset.storage },
    detector: structuredClone(preset.detector),
  };
  if (preset.loginUrl) input.loginUrl = preset.loginUrl;
  if (preset.recentPattern) input.recentPattern = preset.recentPattern;
  if (preset.titleSuffix) input.titleSuffix = preset.titleSuffix;
  return input;
}

export function appToInput(app: AppDef): AppInput {
  const input: AppInput = {
    name: app.name,
    color: app.color,
    domains: [...app.domains],
    origin: app.origin,
    homeUrl: app.homeUrl,
    stagingPath: app.stagingPath,
    storage: { ...app.storage },
    detector: structuredClone(app.detector),
  };
  if (app.presetId) input.presetId = app.presetId;
  if (app.loginUrl) input.loginUrl = app.loginUrl;
  if (app.recentPattern) input.recentPattern = app.recentPattern;
  if (app.titleSuffix) input.titleSuffix = app.titleSuffix;
  return input;
}

const CUSTOM_COLORS = ['#c8402b', '#2f4e86', '#1f6b52', '#94661a', '#8c2f55', '#1f5f6b', '#6b4f9e', '#4a4440'];

/** Suggests an app for any site from one of its URLs: name, domain, origin, home page. */
export function customAppFromUrl(url: string): AppInput | null {
  const parsed = parseHttpUrl(url.trim()) ?? parseHttpUrl(`https://${url.trim()}`);
  if (!parsed) return null;
  const host = normalizeDomain(parsed.hostname);
  if (!host) return null;
  const domain = registrableDomain(host);
  const base = domain.split('.')[0] ?? domain;
  const name = base.charAt(0).toUpperCase() + base.slice(1);
  const color = CUSTOM_COLORS[[...domain].reduce((sum, char) => sum + char.charCodeAt(0), 0) % CUSTOM_COLORS.length]!;
  return {
    name,
    color,
    domains: [domain],
    origin: parsed.origin,
    homeUrl: parsed.pathname.length > 1 ? `${parsed.origin}${parsed.pathname}` : `${parsed.origin}/`,
    stagingPath: '/robots.txt',
    storage: { cookies: true, localStorage: true, sessionStorage: false, indexedDB: false },
    detector: { kind: 'auto' },
  };
}
