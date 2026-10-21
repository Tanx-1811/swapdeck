import type { Page } from '@playwright/test';

/**
 * Realistic demo content for screenshots and visual checks: written straight
 * into chrome.storage.local the way the service worker stores it.
 */

const HOUR = 3600_000;

type DemoOptions = {
  language?: 'en' | 'vi';
  theme?: 'light' | 'dark' | 'system';
  accent?: 'son' | 'ngoc' | 'cham' | 'vang';
  /** Show the reminder to lock saved sessions (hidden by default, e.g. in store screenshots). */
  vaultNudge?: boolean;
  localSupabase?: string;
};

export function demoStorage({
  language = 'en',
  theme = 'light',
  accent = 'son',
  vaultNudge = false,
  localSupabase,
}: DemoOptions = {}) {
  const now = Date.now();
  const supabaseOrigin = localSupabase ?? 'https://supabase.com';
  const app = (
    id: string,
    presetId: string | undefined,
    name: string,
    color: string,
    origin: string,
    domains: string[],
    order: number,
    extra = {},
  ) => ({
    id,
    ...(presetId ? { presetId } : {}),
    name,
    color,
    domains,
    origin,
    homeUrl: `${origin}/`,
    stagingPath: '/robots.txt',
    storage: { cookies: true, localStorage: true, sessionStorage: false, indexedDB: false },
    detector: { kind: 'auto' },
    order,
    createdAt: now - 30 * 24 * HOUR,
    ...extra,
  });
  const apps = [
    app(
      'app_supabase',
      localSupabase ? undefined : 'supabase',
      'Supabase',
      '#3ecf8e',
      supabaseOrigin,
      [new URL(supabaseOrigin).hostname],
      0,
      {
        homeUrl: `${supabaseOrigin}/dashboard/projects`,
        recentPattern: '^/dashboard/project/([a-z0-9]{20})',
        titleSuffix: ' | Supabase',
      },
    ),
    app('app_vercel', 'vercel', 'Vercel', '#171717', 'https://vercel.com', ['vercel.com'], 1),
    app('app_github', 'github', 'GitHub', '#24292f', 'https://github.com', ['github.com'], 2),
    app('app_netlify', 'netlify', 'Netlify', '#00ad9f', 'https://app.netlify.com', ['netlify.com'], 3),
    app('app_chatgpt', 'chatgpt', 'ChatGPT', '#10a37f', 'https://chatgpt.com', ['chatgpt.com', 'openai.com'], 4),
  ];
  const stats = (cookies: number, keys: number, kb: number) => ({
    cookies,
    storageKeys: keys,
    databases: 0,
    bytes: kb * 1024,
  });
  const account = (
    id: string,
    appId: string,
    label: string,
    email: string,
    color: string,
    order: number,
    extra: Record<string, unknown> = {},
  ) => ({
    id,
    appId,
    label,
    email,
    identityId: `${id}-user`,
    color,
    pins: [],
    recents: [],
    order,
    createdAt: now - 20 * 24 * HOUR,
    lastUsedAt: now - (order + 1) * 5 * HOUR,
    capturedAt: now - (order + 1) * 0.4 * HOUR,
    stats: stats(9 + order * 3, 6 + order, 14 + order * 5),
    switchCount: 12 - order * 3,
    ...extra,
  });
  const projectUrl = (ref: string) => `${supabaseOrigin}/dashboard/project/${ref}`;
  const vi = language === 'vi';
  const accounts = [
    account('acc_work', 'app_supabase', vi ? 'Công ty' : 'Work', 'minh@company.example', '#c8402b', 0, {
      icon: 'briefcase',
      note: vi ? 'Dự án chính · chủ thanh toán' : 'Main projects · billing owner',
      recents: [
        { key: 'qwertyuiopasdfghjklz', title: 'orbit-prod', url: projectUrl('qwertyuiopasdfghjklz'), at: now - HOUR },
        {
          key: 'mnbvcxzlkjhgfdsapoiu',
          title: 'orbit-staging',
          url: projectUrl('mnbvcxzlkjhgfdsapoiu'),
          at: now - 2 * HOUR,
        },
      ],
      pins: [
        {
          id: 'pin_sql',
          title: vi ? 'SQL editor' : 'SQL editor',
          url: `${projectUrl('qwertyuiopasdfghjklz')}/sql/new`,
        },
      ],
    }),
    account('acc_personal', 'app_supabase', vi ? 'Cá nhân' : 'Personal', 'minh.home@example.com', '#2f4e86', 1, {
      recents: [
        {
          key: 'zxcvbnmasdfghjklqwer',
          title: 'notes-app',
          url: projectUrl('zxcvbnmasdfghjklqwer'),
          at: now - 9 * HOUR,
        },
      ],
    }),
    account(
      'acc_client',
      'app_supabase',
      vi ? 'Khách hàng — Acme' : 'Client — Acme',
      'dev@acme.example',
      '#94661a',
      2,
      {
        icon: 'handshake',
        important: true,
      },
    ),
    account('acc_side', 'app_supabase', vi ? 'Dự án phụ' : 'Side project', 'hello@sideproject.example', '#1f6b52', 3),
    account('acc_vercel_team', 'app_vercel', 'Studio Team', 'minh@company.example', '#4a4440', 0),
    account('acc_vercel_me', 'app_vercel', vi ? 'Cá nhân' : 'Personal', 'minh.home@example.com', '#2f4e86', 1),
    account('acc_gh_main', 'app_github', 'octo-dev', 'minh@company.example', '#3d6f8f', 0, {
      email: undefined,
      name: 'octo-dev',
    }),
    account('acc_gh_bot', 'app_github', 'deploy-bot', 'bot@company.example', '#6b4f9e', 1),
    account('acc_netlify', 'app_netlify', 'Agency', 'ops@agency.example', '#1f5f6b', 0),
    account('acc_gpt_work', 'app_chatgpt', 'Team plan', 'minh@company.example', '#1f6b52', 0),
    account('acc_gpt_me', 'app_chatgpt', vi ? 'Cá nhân' : 'Personal', 'minh.home@example.com', '#a34d63', 1),
  ];
  const history = [
    { kind: 'switch', appId: 'app_supabase', appName: 'Supabase', from: 'acc_personal', to: 'acc_work', ago: 0.2 },
    { kind: 'auto-save', appId: 'app_supabase', appName: 'Supabase', from: null, to: 'acc_side', ago: 3 },
    { kind: 'switch', appId: 'app_github', appName: 'GitHub', from: 'acc_gh_bot', to: 'acc_gh_main', ago: 5 },
    { kind: 'fresh', appId: 'app_supabase', appName: 'Supabase', from: 'acc_client', to: null, ago: 3.1 },
    { kind: 'switch', appId: 'app_vercel', appName: 'Vercel', from: 'acc_vercel_me', to: 'acc_vercel_team', ago: 26 },
    { kind: 'switch', appId: 'app_chatgpt', appName: 'ChatGPT', from: 'acc_gpt_me', to: 'acc_gpt_work', ago: 30 },
  ].map((entry, index) => ({
    id: `h_${index}`,
    at: now - entry.ago * HOUR,
    kind: entry.kind,
    appId: entry.appId,
    appName: entry.appName,
    fromId: entry.from,
    fromLabel: accounts.find((item) => item.id === entry.from)?.label,
    toId: entry.to,
    toLabel: accounts.find((item) => item.id === entry.to)?.label,
    ok: true,
  }));
  return {
    'sd:apps': apps,
    'sd:accounts': accounts,
    'sd:active': {
      app_supabase: 'acc_work',
      app_vercel: 'acc_vercel_team',
      app_github: 'acc_gh_main',
      app_netlify: 'acc_netlify',
      app_chatgpt: 'acc_gpt_work',
    },
    'sd:settings': {
      language,
      theme,
      accent,
      vaultNudgeUntil: vaultNudge ? 0 : now + 365 * 24 * HOUR,
      afterSwitch: 'last',
      autoCapture: true,
      autoSync: true,
      pageToasts: true,
      confirmSwitch: false,
      badge: true,
      autoLockMinutes: 30,
    },
    'sd:history': history,
    'sd:workspaces': [
      {
        id: 'ws_company',
        name: vi ? 'Công ty' : 'Company',
        color: '#c8402b',
        icon: 'building',
        note: vi ? 'Tài khoản công việc chính' : 'Main work accounts',
        members: {
          app_supabase: 'acc_work',
          app_vercel: 'acc_vercel_team',
          app_github: 'acc_gh_main',
          app_chatgpt: 'acc_gpt_work',
          app_netlify: 'acc_netlify',
        },
        links: [
          { id: 'pin_ws1', title: 'orbit-prod', url: `${supabaseOrigin}/dashboard/project/qwertyuiopasdfghjklz` },
          { id: 'pin_ws2', title: 'Vercel', url: 'https://vercel.com/dashboard' },
        ],
        order: 0,
        createdAt: now - 10 * 24 * HOUR,
        lastUsedAt: now - 0.2 * HOUR,
        switchCount: 14,
      },
      {
        id: 'ws_personal',
        name: vi ? 'Cá nhân' : 'Personal',
        color: '#2f4e86',
        icon: 'house',
        members: { app_supabase: 'acc_personal', app_vercel: 'acc_vercel_me', app_chatgpt: 'acc_gpt_me' },
        links: [],
        order: 1,
        createdAt: now - 9 * 24 * HOUR,
        lastUsedAt: now - 26 * HOUR,
        switchCount: 6,
      },
      {
        id: 'ws_client',
        name: vi ? 'Khách hàng Acme' : 'Client Acme',
        color: '#94661a',
        icon: 'handshake',
        members: { app_supabase: 'acc_client', app_github: 'acc_gh_bot' },
        links: [],
        order: 2,
        createdAt: now - 5 * 24 * HOUR,
        switchCount: 3,
      },
    ],
  };
}

/** Replaces the extension's stored data with demo content (call from any extension page). */
export async function seedDemo(page: Page, options: DemoOptions = {}): Promise<void> {
  await page.evaluate(async (items) => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set(items);
  }, demoStorage(options));
}
