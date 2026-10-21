import { appForUrl } from './domains';
import type { AppDef, DetectorSpec, StorageKinds } from './types';

export type PresetCategory =
  | 'backend'
  | 'hosting'
  | 'cloud'
  | 'devtools'
  | 'ai'
  | 'work'
  | 'design'
  | 'business'
  | 'commerce'
  | 'social'
  | 'vietnam';

export type Preset = Omit<AppDef, 'id' | 'presetId' | 'order' | 'createdAt'> & {
  id: string;
  category: PresetCategory;
  /** Extra search words. */
  keywords?: string[];
  /** The site has its own account switcher; Swapdeck still works but isn't required. */
  nativeSwitcher?: boolean;
};

/**
 * backend: databases, BaaS, auth · hosting: deploy platforms, edge · cloud: servers, VPS, cloud consoles ·
 * devtools: code hosting, CI, registries, API tools, monitoring · ai: AI chat, APIs, builders ·
 * work: projects, communication, docs · design: design and site builders ·
 * business: payments, email and marketing, analytics, accounting, domains ·
 * commerce: online sales channels · social: social networks · vietnam: Vietnamese services.
 */
export const PRESET_CATEGORIES: PresetCategory[] = [
  'backend',
  'hosting',
  'cloud',
  'devtools',
  'ai',
  'work',
  'design',
  'business',
  'commerce',
  'social',
  'vietnam',
];

const STANDARD: StorageKinds = { cookies: true, localStorage: true, sessionStorage: false, indexedDB: false };
const AUTO: DetectorSpec = { kind: 'auto' };

function preset(
  id: string,
  name: string,
  category: PresetCategory,
  color: string,
  site: { origin: string; domains: string[]; home?: string; login?: string },
  extra: Partial<Preset> = {},
): Preset {
  return {
    id,
    name,
    category,
    color,
    domains: site.domains,
    origin: site.origin,
    homeUrl: site.home ?? `${site.origin}/`,
    ...(site.login ? { loginUrl: site.login } : {}),
    stagingPath: '/robots.txt',
    storage: STANDARD,
    detector: AUTO,
    ...extra,
  };
}

/*
 * Built-in recipes. Supabase comes first: it is what Swapdeck was made for.
 *
 * `origin` is the dashboard whose local storage holds the session; `domains`
 * are the registrable domains whose cookies form the sign-in, including the
 * service's own sign-in domain when it differs (e.g. Atlassian's id.atlassian.com).
 * Shared identity providers (WorkOS, Auth0, Google…) are never listed for
 * another service. The switching page (`stagingPath`) must stay on `origin`
 * even for a signed-out visitor. Checked against the live sites with
 * `node scripts/verify-presets.mjs`; some answer scripted requests with 403
 * (Cloudflare, npm, CodeSandbox, Midjourney, Grok, Canva, Shopify, WordPress.com,
 * Vultr, Hostinger, Contabo…) although the hosts are right.
 *
 * Left out on purpose: sites signed in with a Google, Microsoft or Apple
 * account only (Firebase, Azure, Play Console, App Store Connect, Google Ads);
 * anything sharing a domain with a preset (TikTok Shop and TikTok Ads use
 * tiktok.com, Meta Business uses facebook.com, OpenAI Platform is covered by
 * ChatGPT, Bitbucket and Jira by Atlassian); Amazon Seller Central (its session
 * lives on amazon.com); Zalo (its web app keeps the whole chat database in
 * IndexedDB); KiotViet (every shop signs in on its own subdomain); Zeabur (its
 * dashboard sends every signed-out request, files included, to zeabur.com, so
 * there is no page to switch on).
 */
// prettier-ignore
export const PRESETS: Preset[] = [
  // --- Backend & data ---------------------------------------------------------
  preset(
    'supabase',
    'Supabase',
    'backend',
    '#3ecf8e',
    {
      origin: 'https://supabase.com',
      domains: ['supabase.com'],
      home: 'https://supabase.com/dashboard/projects',
      login: 'https://supabase.com/dashboard/sign-in',
    },
    {
      // The dashboard keeps its session in local storage; the user is stored next to it.
      detector: {
        kind: 'localStorage',
        keys: ['supabase.dashboard.auth.token-user', 'supabase.dashboard.auth.token'],
      },
      recentPattern: '^/dashboard/project/([a-z0-9]{20})',
      titleSuffix: ' | Supabase',
      keywords: ['database', 'postgres', 'auth', 'cơ sở dữ liệu'],
    },
  ),
  preset('neon', 'Neon', 'backend', '#00b383', { origin: 'https://console.neon.tech', domains: ['neon.tech'], home: 'https://console.neon.tech/app/projects' }, { recentPattern: '^/app/projects/([a-z0-9-]+)', keywords: ['postgres', 'database', 'cơ sở dữ liệu'] }),
  preset('mongodb', 'MongoDB Atlas', 'backend', '#13aa52', { origin: 'https://cloud.mongodb.com', domains: ['mongodb.com'] }, { keywords: ['atlas', 'database', 'nosql', 'cơ sở dữ liệu'] }),
  preset('planetscale', 'PlanetScale', 'backend', '#1f1f1f', { origin: 'https://app.planetscale.com', domains: ['planetscale.com'], login: 'https://auth.planetscale.com/sign-in' }, { keywords: ['mysql', 'vitess', 'postgres', 'database'] }),
  preset('turso', 'Turso', 'backend', '#4ff8d2', { origin: 'https://app.turso.tech', domains: ['turso.tech'], login: 'https://app.turso.tech/login' }, { keywords: ['sqlite', 'libsql', 'database'] }),
  preset('xata', 'Xata', 'backend', '#ae49ff', { origin: 'https://console.xata.io', domains: ['xata.io'] }, { keywords: ['postgres', 'database'] }),
  preset('redis', 'Redis Cloud', 'backend', '#dc382d', { origin: 'https://cloud.redis.io', domains: ['redis.io'] }, { keywords: ['redis', 'cache', 'redislabs'] }),
  preset('upstash', 'Upstash', 'backend', '#00c98d', { origin: 'https://console.upstash.com', domains: ['upstash.com'] }, { keywords: ['redis', 'kafka', 'qstash', 'vector'] }),
  preset('aiven', 'Aiven', 'backend', '#ff3554', { origin: 'https://console.aiven.io', domains: ['aiven.io'] }, { keywords: ['postgres', 'kafka', 'mysql', 'database'] }),
  preset('pinecone', 'Pinecone', 'backend', '#2b2b2b', { origin: 'https://app.pinecone.io', domains: ['pinecone.io'] }, { keywords: ['vector', 'database', 'rag'] }),
  preset('prisma', 'Prisma Data Platform', 'backend', '#2d3748', { origin: 'https://console.prisma.io', domains: ['prisma.io'], login: 'https://console.prisma.io/login' }, { keywords: ['orm', 'accelerate', 'postgres'] }),
  preset('appwrite', 'Appwrite Cloud', 'backend', '#fd366e', { origin: 'https://cloud.appwrite.io', domains: ['appwrite.io'], home: 'https://cloud.appwrite.io/console' }, { keywords: ['baas', 'backend', 'auth'] }),
  preset('nhost', 'Nhost', 'backend', '#0052cd', { origin: 'https://app.nhost.io', domains: ['nhost.io'] }, { keywords: ['graphql', 'postgres', 'baas'] }),
  preset('hasura', 'Hasura Cloud', 'backend', '#1eb4d4', { origin: 'https://cloud.hasura.io', domains: ['hasura.io'] }, { keywords: ['graphql', 'api'] }),
  preset('convex', 'Convex', 'backend', '#ee342f', { origin: 'https://dashboard.convex.dev', domains: ['convex.dev'] }, { keywords: ['backend', 'database'] }),
  preset('clerk', 'Clerk', 'backend', '#6c47ff', { origin: 'https://dashboard.clerk.com', domains: ['clerk.com'] }, { keywords: ['auth', 'đăng nhập'] }),
  // Static files answer an empty 404 (a browser error page) and everything else redirects to auth0.auth0.com
  // while signed out; /api answers a plain-text 401 on the dashboard's own address.
  preset('auth0', 'Auth0', 'backend', '#eb5424', { origin: 'https://manage.auth0.com', domains: ['auth0.com'], login: 'https://manage.auth0.com/login' }, { stagingPath: '/api', keywords: ['auth', 'okta', 'sso'] }),
  preset('kinde', 'Kinde', 'backend', '#3d3d3d', { origin: 'https://app.kinde.com', domains: ['kinde.com'] }, { keywords: ['auth'] }),
  // Signed-out visits to the dashboard go to signin.workos.com, except for this file.
  preset('workos', 'WorkOS', 'backend', '#6363f1', { origin: 'https://dashboard.workos.com', domains: ['workos.com'] }, { stagingPath: '/favicon.ico', keywords: ['auth', 'sso', 'authkit'] }),

  // --- Hosting ----------------------------------------------------------------
  preset('vercel', 'Vercel', 'hosting', '#171717', { origin: 'https://vercel.com', domains: ['vercel.com'], home: 'https://vercel.com/dashboard', login: 'https://vercel.com/login' }, { keywords: ['deploy', 'nextjs'] }),
  preset('netlify', 'Netlify', 'hosting', '#00ad9f', { origin: 'https://app.netlify.com', domains: ['netlify.com'], login: 'https://app.netlify.com/login' }, { recentPattern: '^/(?:sites|projects)/([^/]+)', titleSuffix: ' | Netlify', keywords: ['deploy'] }),
  preset('cloudflare', 'Cloudflare', 'hosting', '#f38020', { origin: 'https://dash.cloudflare.com', domains: ['cloudflare.com'] }, { keywords: ['dns', 'workers', 'pages', 'cdn', 'tên miền'] }),
  preset('railway', 'Railway', 'hosting', '#853bce', { origin: 'https://railway.com', domains: ['railway.com'], home: 'https://railway.com/dashboard' }, { recentPattern: '^/project/([0-9a-f-]{36})', keywords: ['deploy'] }),
  preset('render', 'Render', 'hosting', '#4351e8', { origin: 'https://dashboard.render.com', domains: ['render.com'] }, { keywords: ['deploy'] }),
  preset('fly', 'Fly.io', 'hosting', '#7b3be2', { origin: 'https://fly.io', domains: ['fly.io'], home: 'https://fly.io/dashboard' }, { keywords: ['deploy'] }),
  preset('heroku', 'Heroku', 'hosting', '#430098', { origin: 'https://dashboard.heroku.com', domains: ['heroku.com'] }, { keywords: ['deploy', 'salesforce'] }),
  preset('deno', 'Deno Deploy', 'hosting', '#0b0d10', { origin: 'https://console.deno.com', domains: ['deno.com'], login: 'https://console.deno.com/login' }, { keywords: ['deploy', 'edge', 'deno'] }),
  preset('koyeb', 'Koyeb', 'hosting', '#2e2e3a', { origin: 'https://app.koyeb.com', domains: ['koyeb.com'] }, { keywords: ['deploy', 'serverless'] }),

  // --- Cloud & servers --------------------------------------------------------
  preset('aws', 'AWS Console', 'cloud', '#ff9900', { origin: 'https://console.aws.amazon.com', domains: ['aws.amazon.com', 'awsapps.com'], home: 'https://console.aws.amazon.com/console/home' }, { nativeSwitcher: true, keywords: ['amazon web services', 'ec2', 's3', 'lambda', 'iam'] }),
  preset('digitalocean', 'DigitalOcean', 'cloud', '#0080ff', { origin: 'https://cloud.digitalocean.com', domains: ['digitalocean.com'] }, { stagingPath: '/manifest.json', keywords: ['vps', 'droplet', 'máy chủ'] }),
  preset('vultr', 'Vultr', 'cloud', '#007bfc', { origin: 'https://console.vultr.com', domains: ['vultr.com'] }, { keywords: ['vps', 'máy chủ'] }),
  preset('linode', 'Linode (Akamai)', 'cloud', '#02b159', { origin: 'https://cloud.linode.com', domains: ['linode.com'], login: 'https://login.linode.com/login' }, { keywords: ['vps', 'akamai', 'máy chủ'] }),
  preset('hetzner', 'Hetzner', 'cloud', '#d50c2d', { origin: 'https://console.hetzner.com', domains: ['hetzner.com', 'hetzner.cloud'], login: 'https://accounts.hetzner.com/login' }, { keywords: ['vps', 'dedicated', 'máy chủ'] }),
  preset('hostinger', 'Hostinger', 'cloud', '#673de6', { origin: 'https://hpanel.hostinger.com', domains: ['hostinger.com'] }, { keywords: ['hosting', 'vps', 'hpanel', 'tên miền'] }),
  preset('contabo', 'Contabo', 'cloud', '#007fc8', { origin: 'https://my.contabo.com', domains: ['contabo.com'] }, { keywords: ['vps', 'máy chủ'] }),
  preset('oracle', 'Oracle Cloud', 'cloud', '#c74634', { origin: 'https://cloud.oracle.com', domains: ['oracle.com', 'oraclecloud.com'] }, { keywords: ['oci', 'vps', 'máy chủ'] }),

  // --- Developer tools --------------------------------------------------------
  preset('github', 'GitHub', 'devtools', '#24292f', { origin: 'https://github.com', domains: ['github.com'], login: 'https://github.com/login' }, {
    // GitHub names the signed-in user in a readable cookie.
    detector: { kind: 'cookie', names: ['dotcom_user'], format: 'plain' },
    nativeSwitcher: true,
    keywords: ['git', 'code'],
  }),
  preset('gitlab', 'GitLab', 'devtools', '#fc6d26', { origin: 'https://gitlab.com', domains: ['gitlab.com'], login: 'https://gitlab.com/users/sign_in' }, { keywords: ['git', 'code', 'ci'] }),
  preset('atlassian', 'Atlassian (Jira, Confluence, Bitbucket)', 'devtools', '#0c66e4', { origin: 'https://home.atlassian.com', domains: ['atlassian.com', 'atlassian.net', 'bitbucket.org'], login: 'https://id.atlassian.com/login' }, { nativeSwitcher: true, keywords: ['jira', 'confluence', 'bitbucket', 'git'] }),
  preset('circleci', 'CircleCI', 'devtools', '#343434', { origin: 'https://app.circleci.com', domains: ['circleci.com'] }, { keywords: ['ci', 'cd'] }),
  preset('docker', 'Docker Hub', 'devtools', '#1d63ed', { origin: 'https://hub.docker.com', domains: ['docker.com'] }, { keywords: ['container', 'registry'] }),
  preset('npm', 'npm', 'devtools', '#cb3837', { origin: 'https://www.npmjs.com', domains: ['npmjs.com'], login: 'https://www.npmjs.com/login' }, { keywords: ['registry', 'package', 'node'] }),
  preset('huggingface', 'Hugging Face', 'devtools', '#ffd21e', { origin: 'https://huggingface.co', domains: ['huggingface.co'], login: 'https://huggingface.co/login' }, { keywords: ['models', 'datasets', 'spaces', 'ai'] }),
  preset('replit', 'Replit', 'devtools', '#f26207', { origin: 'https://replit.com', domains: ['replit.com'], login: 'https://replit.com/login' }, { keywords: ['ide', 'agent'] }),
  preset('codesandbox', 'CodeSandbox', 'devtools', '#151515', { origin: 'https://codesandbox.io', domains: ['codesandbox.io'], home: 'https://codesandbox.io/dashboard' }, { keywords: ['ide', 'sandbox'] }),
  preset('stackblitz', 'StackBlitz', 'devtools', '#1389fd', { origin: 'https://stackblitz.com', domains: ['stackblitz.com'] }, { keywords: ['ide', 'webcontainers'] }),
  preset('expo', 'Expo', 'devtools', '#4630eb', { origin: 'https://expo.dev', domains: ['expo.dev'], login: 'https://expo.dev/login' }, { keywords: ['react native', 'eas', 'mobile'] }),
  preset('jetbrains', 'JetBrains Account', 'devtools', '#ff318c', { origin: 'https://account.jetbrains.com', domains: ['jetbrains.com'], login: 'https://account.jetbrains.com/login' }, { keywords: ['license', 'intellij', 'webstorm'] }),
  preset('postman', 'Postman', 'devtools', '#ff6c37', { origin: 'https://web.postman.co', domains: ['postman.co', 'postman.com', 'getpostman.com'] }, { keywords: ['api'] }),
  preset('cloudinary', 'Cloudinary', 'devtools', '#3448c5', { origin: 'https://console.cloudinary.com', domains: ['cloudinary.com'] }, { keywords: ['images', 'media', 'cdn'] }),
  preset('algolia', 'Algolia', 'devtools', '#003dff', { origin: 'https://dashboard.algolia.com', domains: ['algolia.com'], login: 'https://dashboard.algolia.com/users/sign_in' }, { keywords: ['search'] }),
  preset('twilio', 'Twilio', 'devtools', '#f22f46', { origin: 'https://console.twilio.com', domains: ['twilio.com'] }, { keywords: ['sms', 'voice', 'otp'] }),
  preset('onesignal', 'OneSignal', 'devtools', '#e54b4d', { origin: 'https://dashboard.onesignal.com', domains: ['onesignal.com'] }, { keywords: ['push', 'notifications', 'thông báo'] }),
  preset('pusher', 'Pusher', 'devtools', '#300d4f', { origin: 'https://dashboard.pusher.com', domains: ['pusher.com'], login: 'https://dashboard.pusher.com/accounts/sign_in' }, { keywords: ['realtime', 'websocket', 'beams'] }),
  preset('ably', 'Ably', 'devtools', '#ff5416', { origin: 'https://ably.com', domains: ['ably.com'], home: 'https://ably.com/accounts', login: 'https://ably.com/login' }, { keywords: ['realtime', 'websocket'] }),
  preset('sentry', 'Sentry', 'devtools', '#362d59', { origin: 'https://sentry.io', domains: ['sentry.io'] }, { keywords: ['errors', 'monitoring'] }),
  // robots.txt and favicon.ico live on static.datadoghq.com; this path stays on the app.
  preset('datadog', 'Datadog', 'devtools', '#632ca6', { origin: 'https://app.datadoghq.com', domains: ['datadoghq.com', 'datadoghq.eu'], login: 'https://app.datadoghq.com/account/login' }, { stagingPath: '/favicon.png', keywords: ['monitoring', 'logs', 'apm'] }),
  preset('newrelic', 'New Relic', 'devtools', '#1ce783', { origin: 'https://one.newrelic.com', domains: ['newrelic.com'], login: 'https://login.newrelic.com/' }, { keywords: ['monitoring', 'apm', 'observability'] }),
  preset('grafana', 'Grafana Cloud', 'devtools', '#f46800', { origin: 'https://grafana.com', domains: ['grafana.com', 'grafana.net'], login: 'https://grafana.com/auth/sign-in' }, { keywords: ['monitoring', 'dashboards', 'prometheus'] }),
  preset('betterstack', 'Better Stack', 'devtools', '#5c5cff', { origin: 'https://uptime.betterstack.com', domains: ['betterstack.com'] }, { keywords: ['uptime', 'logs', 'status page', 'monitoring'] }),
  preset('logrocket', 'LogRocket', 'devtools', '#764abc', { origin: 'https://app.logrocket.com', domains: ['logrocket.com'] }, { keywords: ['session replay', 'monitoring'] }),

  // --- AI ---------------------------------------------------------------------
  preset('chatgpt', 'ChatGPT', 'ai', '#10a37f', { origin: 'https://chatgpt.com', domains: ['chatgpt.com', 'openai.com'] }, { keywords: ['openai', 'gpt', 'api platform'] }),
  preset('claude', 'Claude', 'ai', '#d97757', { origin: 'https://claude.ai', domains: ['claude.ai'] }, { keywords: ['anthropic'] }),
  // The Anthropic Console moved from console.anthropic.com to platform.claude.com.
  preset('claude-console', 'Claude Console', 'ai', '#cc785c', { origin: 'https://platform.claude.com', domains: ['claude.com', 'anthropic.com'] }, { keywords: ['anthropic', 'api', 'console'] }),
  preset('cursor', 'Cursor', 'ai', '#111111', { origin: 'https://cursor.com', domains: ['cursor.com', 'cursor.sh'], home: 'https://cursor.com/dashboard' }, { keywords: ['editor', 'ide'] }),
  preset('openrouter', 'OpenRouter', 'ai', '#6467f2', { origin: 'https://openrouter.ai', domains: ['openrouter.ai'] }, { keywords: ['llm', 'api'] }),
  preset('perplexity', 'Perplexity', 'ai', '#20808d', { origin: 'https://www.perplexity.ai', domains: ['perplexity.ai'] }, { keywords: ['search', 'answer'] }),
  preset('grok', 'Grok', 'ai', '#3a3a3a', { origin: 'https://grok.com', domains: ['grok.com', 'x.ai'] }, { keywords: ['xai', 'x.ai'] }),
  preset('deepseek', 'DeepSeek', 'ai', '#4d6bfe', { origin: 'https://chat.deepseek.com', domains: ['deepseek.com'] }, { keywords: ['chat', 'api'] }),
  // The console sends every signed-out request to auth.mistral.ai; Le Chat and the console
  // share one cookie session on mistral.ai, so the switch happens on chat.mistral.ai.
  preset('mistral', 'Mistral AI', 'ai', '#fa520f', { origin: 'https://chat.mistral.ai', domains: ['mistral.ai'], home: 'https://console.mistral.ai/' }, { keywords: ['le chat', 'la plateforme', 'console', 'api'] }),
  preset('groq', 'Groq', 'ai', '#f55036', { origin: 'https://console.groq.com', domains: ['groq.com'], home: 'https://console.groq.com/home' }, { keywords: ['api', 'llm', 'inference'] }),
  preset('replicate', 'Replicate', 'ai', '#202020', { origin: 'https://replicate.com', domains: ['replicate.com'], home: 'https://replicate.com/dashboard', login: 'https://replicate.com/signin' }, { keywords: ['models', 'api'] }),
  preset('poe', 'Poe', 'ai', '#5d5cde', { origin: 'https://poe.com', domains: ['poe.com'], login: 'https://poe.com/login' }, { keywords: ['chat', 'bots'] }),
  preset('midjourney', 'Midjourney', 'ai', '#2a2a2a', { origin: 'https://www.midjourney.com', domains: ['midjourney.com'] }, { keywords: ['image', 'art', 'ảnh'] }),
  preset('elevenlabs', 'ElevenLabs', 'ai', '#1f1f1f', { origin: 'https://elevenlabs.io', domains: ['elevenlabs.io'], home: 'https://elevenlabs.io/app' }, { keywords: ['voice', 'tts', 'giọng nói'] }),
  preset('runway', 'Runway', 'ai', '#111111', { origin: 'https://app.runwayml.com', domains: ['runwayml.com'] }, { keywords: ['video', 'gen'] }),
  preset('lovable', 'Lovable', 'ai', '#f04e98', { origin: 'https://lovable.dev', domains: ['lovable.dev'] }, { keywords: ['app builder', 'no-code'] }),
  // Bolt signs in with a StackBlitz account; v0 with a Vercel account.
  preset('bolt', 'Bolt', 'ai', '#1488fc', { origin: 'https://bolt.new', domains: ['bolt.new'] }, { keywords: ['app builder', 'stackblitz'] }),
  preset('v0', 'v0', 'ai', '#000000', { origin: 'https://v0.app', domains: ['v0.app', 'v0.dev'] }, { keywords: ['app builder', 'vercel', 'ui'] }),

  // --- Work & collaboration ---------------------------------------------------
  preset('slack', 'Slack', 'work', '#4a154b', { origin: 'https://app.slack.com', domains: ['slack.com'], home: 'https://app.slack.com/client', login: 'https://slack.com/signin' }, { nativeSwitcher: true, keywords: ['chat', 'workspace', 'nhắn tin'] }),
  preset('notion', 'Notion', 'work', '#191919', { origin: 'https://app.notion.com', domains: ['notion.so', 'notion.com'], login: 'https://app.notion.com/login' }, { nativeSwitcher: true, keywords: ['docs', 'wiki', 'ghi chú'] }),
  preset('linear', 'Linear', 'work', '#5e6ad2', { origin: 'https://linear.app', domains: ['linear.app'] }, { nativeSwitcher: true, keywords: ['issues', 'project'] }),
  // Trello signs in with an Atlassian account (id.atlassian.com, part of the Atlassian preset).
  preset('trello', 'Trello', 'work', '#0079bf', { origin: 'https://trello.com', domains: ['trello.com'], login: 'https://trello.com/login' }, { keywords: ['kanban', 'boards', 'dự án'] }),
  preset('asana', 'Asana', 'work', '#f06a6a', { origin: 'https://app.asana.com', domains: ['asana.com'], login: 'https://app.asana.com/-/login' }, { keywords: ['tasks', 'project', 'dự án'] }),
  preset('clickup', 'ClickUp', 'work', '#7b68ee', { origin: 'https://app.clickup.com', domains: ['clickup.com'], login: 'https://app.clickup.com/login' }, { keywords: ['tasks', 'project', 'dự án'] }),
  preset('monday', 'monday.com', 'work', '#ff3d57', { origin: 'https://auth.monday.com', domains: ['monday.com'], home: 'https://auth.monday.com/login' }, { keywords: ['project', 'crm', 'dự án'] }),
  preset('basecamp', 'Basecamp', 'work', '#1d2d35', { origin: 'https://3.basecamp.com', domains: ['basecamp.com', '37signals.com'], login: 'https://launchpad.37signals.com/signin' }, { keywords: ['project', '37signals', 'dự án'] }),
  preset('miro', 'Miro', 'work', '#ffd02f', { origin: 'https://miro.com', domains: ['miro.com'], home: 'https://miro.com/app/dashboard/', login: 'https://miro.com/login/' }, { keywords: ['whiteboard', 'bảng trắng'] }),
  preset('airtable', 'Airtable', 'work', '#18bfff', { origin: 'https://airtable.com', domains: ['airtable.com'], login: 'https://airtable.com/login' }, { keywords: ['database', 'spreadsheet', 'bảng tính'] }),
  preset('zoom', 'Zoom', 'work', '#0b5cff', { origin: 'https://zoom.us', domains: ['zoom.us', 'zoom.com'], home: 'https://zoom.us/profile', login: 'https://zoom.us/signin' }, { keywords: ['meeting', 'họp'] }),
  preset('loom', 'Loom', 'work', '#625df5', { origin: 'https://www.loom.com', domains: ['loom.com'], home: 'https://www.loom.com/looms', login: 'https://www.loom.com/login' }, { keywords: ['video', 'screen recording', 'quay màn hình'] }),
  preset('calendly', 'Calendly', 'work', '#006bff', { origin: 'https://calendly.com', domains: ['calendly.com'], home: 'https://calendly.com/app/login', login: 'https://calendly.com/app/login' }, { keywords: ['scheduling', 'lịch hẹn'] }),
  preset('zapier', 'Zapier', 'work', '#ff4f00', { origin: 'https://zapier.com', domains: ['zapier.com'], home: 'https://zapier.com/app/home', login: 'https://zapier.com/app/login' }, { keywords: ['automation', 'tự động hóa'] }),
  preset('make', 'Make', 'work', '#6d00cc', { origin: 'https://eu1.make.com', domains: ['make.com'] }, { keywords: ['automation', 'integromat', 'tự động hóa'] }),

  // --- Design & site builders -------------------------------------------------
  preset('figma', 'Figma', 'design', '#a259ff', { origin: 'https://www.figma.com', domains: ['figma.com'], home: 'https://www.figma.com/files/recents-and-sharing' }, { nativeSwitcher: true, keywords: ['design', 'thiết kế'] }),
  preset('canva', 'Canva', 'design', '#00c4cc', { origin: 'https://www.canva.com', domains: ['canva.com'], login: 'https://www.canva.com/login' }, { keywords: ['design', 'thiết kế'] }),
  preset('framer', 'Framer', 'design', '#0055ff', { origin: 'https://framer.com', domains: ['framer.com'], home: 'https://framer.com/projects/', login: 'https://framer.com/login/' }, { keywords: ['website', 'no-code', 'thiết kế'] }),
  preset('webflow', 'Webflow', 'design', '#146ef5', { origin: 'https://webflow.com', domains: ['webflow.com'], home: 'https://webflow.com/dashboard', login: 'https://webflow.com/login' }, { keywords: ['website', 'no-code', 'cms'] }),
  preset('wix', 'Wix', 'design', '#116dff', { origin: 'https://manage.wix.com', domains: ['wix.com'], home: 'https://manage.wix.com/account/sites', login: 'https://users.wix.com/signin' }, { keywords: ['website', 'no-code'] }),
  preset('dribbble', 'Dribbble', 'design', '#ea4c89', { origin: 'https://dribbble.com', domains: ['dribbble.com'], login: 'https://dribbble.com/session/new' }, { keywords: ['portfolio', 'thiết kế'] }),
  preset('spline', 'Spline', 'design', '#5b5bff', { origin: 'https://app.spline.design', domains: ['spline.design'] }, { keywords: ['3d'] }),

  // --- Business: payments, email, analytics, accounting, domains --------------
  preset('stripe', 'Stripe', 'business', '#635bff', { origin: 'https://dashboard.stripe.com', domains: ['stripe.com'] }, { nativeSwitcher: true, keywords: ['payments', 'thanh toán'] }),
  preset('paypal', 'PayPal', 'business', '#003087', { origin: 'https://www.paypal.com', domains: ['paypal.com'], home: 'https://www.paypal.com/myaccount/summary', login: 'https://www.paypal.com/signin' }, { keywords: ['payments', 'thanh toán'] }),
  preset('paddle', 'Paddle', 'business', '#3a37d6', { origin: 'https://vendors.paddle.com', domains: ['paddle.com'], login: 'https://login.paddle.com/login' }, { keywords: ['payments', 'billing', 'thanh toán'] }),
  preset('lemonsqueezy', 'Lemon Squeezy', 'business', '#ffc233', { origin: 'https://app.lemonsqueezy.com', domains: ['lemonsqueezy.com'], home: 'https://app.lemonsqueezy.com/dashboard' }, { keywords: ['payments', 'thanh toán'] }),
  preset('revenuecat', 'RevenueCat', 'business', '#f2545b', { origin: 'https://app.revenuecat.com', domains: ['revenuecat.com'] }, { keywords: ['subscriptions', 'in-app purchases'] }),
  preset('wise', 'Wise', 'business', '#9fe870', { origin: 'https://wise.com', domains: ['wise.com'], home: 'https://wise.com/home', login: 'https://wise.com/login' }, { keywords: ['transfer', 'chuyển tiền', 'transferwise'] }),
  preset('payoneer', 'Payoneer', 'business', '#ff4800', { origin: 'https://myaccount.payoneer.com', domains: ['payoneer.com'], home: 'https://myaccount.payoneer.com/ma/' }, { keywords: ['payments', 'chuyển tiền', 'thanh toán'] }),
  preset('xero', 'Xero', 'business', '#13b5ea', { origin: 'https://go.xero.com', domains: ['xero.com'], home: 'https://go.xero.com/Dashboard/', login: 'https://login.xero.com/' }, { keywords: ['accounting', 'kế toán', 'invoices'] }),
  preset('quickbooks', 'QuickBooks Online', 'business', '#2ca01c', { origin: 'https://qbo.intuit.com', domains: ['intuit.com'], login: 'https://accounts.intuit.com/app/sign-in' }, { keywords: ['accounting', 'kế toán', 'intuit'] }),
  preset('resend', 'Resend', 'business', '#1a1a1a', { origin: 'https://resend.com', domains: ['resend.com'], home: 'https://resend.com/emails', login: 'https://resend.com/login' }, { keywords: ['email', 'smtp'] }),
  preset('sendgrid', 'SendGrid', 'business', '#1a82e2', { origin: 'https://app.sendgrid.com', domains: ['sendgrid.com'] }, { keywords: ['email', 'smtp', 'twilio'] }),
  preset('mailgun', 'Mailgun', 'business', '#f06b66', { origin: 'https://app.mailgun.com', domains: ['mailgun.com'] }, { keywords: ['email', 'smtp'] }),
  preset('postmark', 'Postmark', 'business', '#ffde00', { origin: 'https://account.postmarkapp.com', domains: ['postmarkapp.com'], login: 'https://account.postmarkapp.com/login' }, { keywords: ['email', 'smtp'] }),
  preset('mailchimp', 'Mailchimp', 'business', '#ffe01b', { origin: 'https://login.mailchimp.com', domains: ['mailchimp.com'] }, { keywords: ['email marketing', 'newsletter'] }),
  preset('brevo', 'Brevo', 'business', '#0b996e', { origin: 'https://app.brevo.com', domains: ['brevo.com'] }, { keywords: ['email marketing', 'sendinblue', 'sms'] }),
  preset('hubspot', 'HubSpot', 'business', '#ff7a59', { origin: 'https://app.hubspot.com', domains: ['hubspot.com'], login: 'https://app.hubspot.com/login' }, { keywords: ['crm', 'marketing', 'khách hàng'] }),
  preset('intercom', 'Intercom', 'business', '#0057ff', { origin: 'https://app.intercom.com', domains: ['intercom.com'], login: 'https://app.intercom.com/admins/sign_in' }, { keywords: ['support', 'chat', 'chăm sóc khách hàng'] }),
  preset('posthog', 'PostHog', 'business', '#f54e00', { origin: 'https://us.posthog.com', domains: ['posthog.com'], login: 'https://us.posthog.com/login' }, { keywords: ['analytics', 'product', 'thống kê'] }),
  preset('mixpanel', 'Mixpanel', 'business', '#7856ff', { origin: 'https://mixpanel.com', domains: ['mixpanel.com'], login: 'https://mixpanel.com/login/' }, { keywords: ['analytics', 'thống kê'] }),
  preset('amplitude', 'Amplitude', 'business', '#1e61f0', { origin: 'https://app.amplitude.com', domains: ['amplitude.com'], login: 'https://app.amplitude.com/login' }, { keywords: ['analytics', 'thống kê'] }),
  preset('hotjar', 'Hotjar', 'business', '#fd3a5c', { origin: 'https://insights.hotjar.com', domains: ['hotjar.com'] }, { keywords: ['heatmaps', 'analytics'] }),
  preset('plausible', 'Plausible', 'business', '#5850ec', { origin: 'https://plausible.io', domains: ['plausible.io'], home: 'https://plausible.io/sites', login: 'https://plausible.io/login' }, { keywords: ['analytics', 'thống kê'] }),
  preset('namecheap', 'Namecheap', 'business', '#de3723', { origin: 'https://ap.www.namecheap.com', domains: ['namecheap.com'], login: 'https://www.namecheap.com/myaccount/login/' }, { keywords: ['domains', 'dns', 'tên miền'] }),
  preset('godaddy', 'GoDaddy', 'business', '#1bdbdb', { origin: 'https://account.godaddy.com', domains: ['godaddy.com'], home: 'https://account.godaddy.com/products' }, { keywords: ['domains', 'dns', 'tên miền', 'hosting'] }),
  preset('porkbun', 'Porkbun', 'business', '#ef7878', { origin: 'https://porkbun.com', domains: ['porkbun.com'], home: 'https://porkbun.com/account/domainsSpeedy', login: 'https://porkbun.com/account/login' }, { keywords: ['domains', 'dns', 'tên miền'] }),

  // --- Commerce ---------------------------------------------------------------
  preset('shopify', 'Shopify', 'commerce', '#95bf47', { origin: 'https://admin.shopify.com', domains: ['shopify.com'], login: 'https://accounts.shopify.com/lookup' }, { keywords: ['store', 'bán hàng', 'cửa hàng'] }),
  preset('etsy', 'Etsy', 'commerce', '#f56400', { origin: 'https://www.etsy.com', domains: ['etsy.com'], home: 'https://www.etsy.com/your/shops/me/dashboard', login: 'https://www.etsy.com/signin' }, { keywords: ['store', 'bán hàng'] }),
  preset('ebay', 'eBay', 'commerce', '#e53238', { origin: 'https://www.ebay.com', domains: ['ebay.com'], home: 'https://www.ebay.com/mys/home', login: 'https://signin.ebay.com/' }, { keywords: ['seller', 'bán hàng'] }),
  preset('gumroad', 'Gumroad', 'commerce', '#ff90e8', { origin: 'https://gumroad.com', domains: ['gumroad.com'], home: 'https://gumroad.com/dashboard', login: 'https://gumroad.com/login' }, { keywords: ['digital products', 'bán hàng'] }),
  preset('wordpress', 'WordPress.com', 'commerce', '#3858e9', { origin: 'https://wordpress.com', domains: ['wordpress.com'], home: 'https://wordpress.com/home', login: 'https://wordpress.com/log-in' }, { keywords: ['blog', 'website', 'woocommerce'] }),
  preset('ghost', 'Ghost(Pro)', 'commerce', '#15171a', { origin: 'https://account.ghost.org', domains: ['ghost.org', 'ghost.io'] }, { keywords: ['blog', 'newsletter'] }),
  preset('contentful', 'Contentful', 'commerce', '#0681b6', { origin: 'https://app.contentful.com', domains: ['contentful.com'], login: 'https://be.contentful.com/login' }, { keywords: ['cms', 'headless'] }),
  preset('sanity', 'Sanity', 'commerce', '#f03e2f', { origin: 'https://www.sanity.io', domains: ['sanity.io'], home: 'https://www.sanity.io/manage', login: 'https://www.sanity.io/login' }, { keywords: ['cms', 'headless'] }),

  // --- Social -----------------------------------------------------------------
  preset('facebook', 'Facebook', 'social', '#1877f2', { origin: 'https://www.facebook.com', domains: ['facebook.com'] }, { keywords: ['meta', 'fb', 'business', 'ads', 'quảng cáo'] }),
  preset('messenger', 'Messenger', 'social', '#0084ff', { origin: 'https://www.messenger.com', domains: ['messenger.com'] }, { keywords: ['meta', 'chat', 'nhắn tin'] }),
  preset('instagram', 'Instagram', 'social', '#e1306c', { origin: 'https://www.instagram.com', domains: ['instagram.com'] }, { nativeSwitcher: true, keywords: ['meta', 'ig'] }),
  // Threads signs in with an Instagram account.
  preset('threads', 'Threads', 'social', '#000000', { origin: 'https://www.threads.com', domains: ['threads.com', 'threads.net'] }, { keywords: ['meta'] }),
  preset('x', 'X (Twitter)', 'social', '#111111', { origin: 'https://x.com', domains: ['x.com', 'twitter.com'] }, { nativeSwitcher: true, keywords: ['twitter'] }),
  preset('tiktok', 'TikTok', 'social', '#111111', { origin: 'https://www.tiktok.com', domains: ['tiktok.com'] }, { keywords: ['shop', 'ads', 'seller', 'quảng cáo'] }),
  preset('linkedin', 'LinkedIn', 'social', '#0a66c2', { origin: 'https://www.linkedin.com', domains: ['linkedin.com'], home: 'https://www.linkedin.com/feed/', login: 'https://www.linkedin.com/login' }, { keywords: ['jobs', 'tuyển dụng'] }),
  preset('pinterest', 'Pinterest', 'social', '#e60023', { origin: 'https://www.pinterest.com', domains: ['pinterest.com'] }, { nativeSwitcher: true }),
  preset('reddit', 'Reddit', 'social', '#ff4500', { origin: 'https://www.reddit.com', domains: ['reddit.com'], login: 'https://www.reddit.com/login/' }),
  preset('discord', 'Discord', 'social', '#5865f2', { origin: 'https://discord.com', domains: ['discord.com'], home: 'https://discord.com/app' }, { nativeSwitcher: true, keywords: ['chat'] }),

  // --- Vietnam ------------------------------------------------------------------
  preset('shopee', 'Shopee Kênh Người Bán', 'vietnam', '#ee4d2d', { origin: 'https://banhang.shopee.vn', domains: ['shopee.vn'] }, { keywords: ['mua sắm', 'bán hàng', 'seller center', 'kênh người bán'] }),
  // Seller Center signs in on login.lazada.com.
  preset('lazada', 'Lazada Seller Center', 'vietnam', '#0f146d', { origin: 'https://sellercenter.lazada.vn', domains: ['lazada.vn', 'lazada.com'] }, { keywords: ['mua sắm', 'bán hàng', 'seller center'] }),
  preset('tiki', 'Tiki Seller Center', 'vietnam', '#1a94ff', { origin: 'https://sellercenter.tiki.vn', domains: ['tiki.vn'] }, { keywords: ['mua sắm', 'bán hàng', 'seller center'] }),
  preset('pancake', 'Pancake', 'vietnam', '#ff5722', { origin: 'https://pancake.vn', domains: ['pancake.vn', 'pages.fm'] }, { keywords: ['bán hàng', 'fanpage', 'pos', 'chốt đơn', 'pages.fm'] }),
  preset('haravan', 'Haravan', 'vietnam', '#0091ff', { origin: 'https://accounts.haravan.com', domains: ['haravan.com', 'myharavan.com'] }, { keywords: ['bán hàng', 'website', 'cửa hàng'] }),
  preset('sapo', 'Sapo', 'vietnam', '#00a65a', { origin: 'https://accounts.sapo.vn', domains: ['sapo.vn', 'mysapo.net'], login: 'https://accounts.sapo.vn/login' }, { keywords: ['bán hàng', 'pos', 'cửa hàng'] }),
  preset('nhanh', 'Nhanh.vn', 'vietnam', '#e9302c', { origin: 'https://nhanh.vn', domains: ['nhanh.vn'], login: 'https://nhanh.vn/login' }, { keywords: ['bán hàng', 'quản lý kho', 'pos'] }),
  preset('ghn', 'GHN – Giao Hàng Nhanh', 'vietnam', '#f26522', { origin: 'https://khachhang.ghn.vn', domains: ['ghn.vn'] }, { keywords: ['giao hàng', 'vận chuyển', 'shipping'] }),
  preset('ghtk', 'GHTK – Giao Hàng Tiết Kiệm', 'vietnam', '#069255', { origin: 'https://khachhang.giaohangtietkiem.vn', domains: ['giaohangtietkiem.vn'], home: 'https://khachhang.giaohangtietkiem.vn/web' }, { keywords: ['giao hàng', 'vận chuyển', 'shipping'] }),
  preset('viettelpost', 'Viettel Post', 'vietnam', '#ee0033', { origin: 'https://viettelpost.vn', domains: ['viettelpost.vn'], login: 'https://viettelpost.vn/dang-nhap' }, { keywords: ['giao hàng', 'vận chuyển', 'shipping'] }),
  preset('ahamove', 'Ahamove', 'vietnam', '#f7941d', { origin: 'https://partner.ahamove.com', domains: ['ahamove.com'], home: 'https://partner.ahamove.com/v2/' }, { keywords: ['giao hàng', 'vận chuyển', 'shipping'] }),
  preset('misa', 'MISA AMIS', 'vietnam', '#0066b3', { origin: 'https://amis.misa.vn', domains: ['misa.vn'], login: 'https://id.misa.vn/Account/Login' }, { keywords: ['kế toán', 'hóa đơn', 'nhân sự', 'accounting'] }),
  preset('base', 'Base.vn', 'vietnam', '#2f80ed', { origin: 'https://account.base.vn', domains: ['base.vn'], login: 'https://account.base.vn/a/login' }, { keywords: ['quản trị', 'nhân sự', 'công việc'] }),
  preset('momo', 'MoMo Business', 'vietnam', '#a50064', { origin: 'https://business.momo.vn', domains: ['momo.vn'] }, { keywords: ['thanh toán', 'ví điện tử', 'payments'] }),
  preset('zalopay', 'ZaloPay Merchant', 'vietnam', '#0068ff', { origin: 'https://mc.zalopay.vn', domains: ['zalopay.vn'] }, { keywords: ['thanh toán', 'ví điện tử', 'payments'] }),
  preset('matbao', 'Mắt Bão', 'vietnam', '#2196f3', { origin: 'https://manage.matbao.net', domains: ['matbao.net'] }, { keywords: ['tên miền', 'hosting', 'email', 'domains'] }),
  // Unknown paths on id.pavietnam.vn redirect to another subdomain, so the switch uses its home page.
  preset('pavietnam', 'PA Việt Nam', 'vietnam', '#0066cc', { origin: 'https://id.pavietnam.vn', domains: ['pavietnam.vn'] }, { stagingPath: '/', keywords: ['tên miền', 'hosting', 'domains'] }),
  preset('inet', 'iNET', 'vietnam', '#e31e24', { origin: 'https://dms.inet.vn', domains: ['inet.vn'] }, { keywords: ['tên miền', 'hosting', 'domains'] }),
  preset('tenten', 'Tenten', 'vietnam', '#ff6600', { origin: 'https://id.tenten.vn', domains: ['tenten.vn'], login: 'https://id.tenten.vn/login' }, { keywords: ['tên miền', 'hosting', 'domains'] }),
  preset('bizfly', 'Bizfly Cloud', 'vietnam', '#ff6c00', { origin: 'https://manage.bizflycloud.vn', domains: ['bizflycloud.vn'], home: 'https://manage.bizflycloud.vn/dashboard' }, { keywords: ['cloud', 'vps', 'máy chủ'] }),
];

/** The built-in preset for a URL's site, if there is one. */
export function presetForUrl(url: string | null | undefined): Preset | null {
  return appForUrl(PRESETS, url);
}

export function findPreset(id: string | undefined): Preset | undefined {
  return id ? PRESETS.find((preset) => preset.id === id) : undefined;
}

/**
 * Sites Swapdeck refuses to manage: their sign-in is shared with the browser
 * itself (swapping it can sign Chrome out of sync) and they switch accounts natively.
 */
const BLOCKED_DOMAINS = ['google.com', 'youtube.com', 'gmail.com', 'microsoftonline.com', 'live.com', 'apple.com'];

export function isBlockedDomain(domain: string): boolean {
  const d = domain.toLowerCase();
  return BLOCKED_DOMAINS.some((blocked) => d === blocked || d.endsWith(`.${blocked}`));
}

/** Plain-text search over presets (name, id, domains, keywords), accent-insensitive. */
export function searchPresets(query: string, presets: readonly Preset[] = PRESETS): Preset[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...presets];
  return presets.filter((preset) => {
    const haystack = fold([preset.name, preset.id, ...preset.domains, ...(preset.keywords ?? [])].join(' '));
    return words.every((word) => haystack.includes(word));
  });
}

export function fold(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
}
