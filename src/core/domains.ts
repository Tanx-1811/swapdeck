import type { AppDef, CookieRecord } from './types';

/**
 * Suffixes under which every subdomain is a separate site (a small, hand-picked
 * part of the Public Suffix List): country second levels and hosting platforms.
 * Used only to suggest domains for a custom app; the user can always edit them.
 */
// prettier-ignore
const PUBLIC_SUFFIXES = new Set([
  // Country second levels.
  'com.vn', 'net.vn', 'org.vn', 'edu.vn', 'gov.vn', 'info.vn', 'biz.vn', 'name.vn', 'pro.vn', 'id.vn', 'io.vn',
  'ac.vn', 'health.vn', 'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'com.au', 'net.au', 'org.au', 'edu.au',
  'co.jp', 'ne.jp', 'or.jp', 'com.br', 'com.cn', 'net.cn', 'org.cn', 'com.sg', 'edu.sg', 'com.my', 'co.kr',
  'co.in', 'co.id', 'co.th', 'in.th', 'com.tw', 'com.hk', 'com.ph', 'co.nz', 'com.mx', 'com.ar', 'com.tr', 'co.za',
  // Hosting platforms.
  'vercel.app', 'netlify.app', 'github.io', 'gitlab.io', 'pages.dev', 'workers.dev', 'web.app', 'firebaseapp.com',
  'herokuapp.com', 'onrender.com', 'fly.dev', 'railway.app', 'up.railway.app', 'supabase.co', 'glitch.me',
  'replit.app', 'repl.co', 'surge.sh', 'azurewebsites.net', 'cloudfront.net', 'appspot.com', 'ngrok.io',
  'ngrok-free.app', 'trycloudflare.com', 'deno.dev', 'webflow.io', 'framer.app', 'wixsite.com', 'blogspot.com',
  'myshopify.com', 'lovable.app', 'bubbleapps.io',
]);

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

export function isIpOrLocal(host: string): boolean {
  return host === 'localhost' || IPV4.test(host) || host.startsWith('[') || !host.includes('.');
}

/** "a.b.example.com" → "example.com"; "app.vercel.app" → "app.vercel.app"; "x.com.vn" → "x.com.vn". */
export function registrableDomain(host: string): string {
  const clean = host.toLowerCase().replace(/\.$/, '');
  if (isIpOrLocal(clean)) return clean;
  const labels = clean.split('.');
  // Longest matching suffix wins (e.g. "up.railway.app" over "railway.app").
  for (let i = 0; i < labels.length - 1; i++) {
    const suffix = labels.slice(i + 1).join('.');
    if (PUBLIC_SUFFIXES.has(suffix)) return labels.slice(i).join('.');
  }
  return labels.slice(-2).join('.');
}

/**
 * Normalises user input ("https://App.Example.com:8080/x", "*.example.com", ".example.com")
 * to a bare lowercase host. Returns null when it isn't a plausible host name.
 */
export function normalizeDomain(input: string): string | null {
  let value = input.trim().toLowerCase();
  if (!value) return null;
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  value = value.split(/[/?#]/)[0] ?? '';
  value = value.replace(/^\*\./, '').replace(/^\.+/, '').replace(/\.+$/, '');
  if (!value.startsWith('[')) value = value.replace(/:\d+$/, '');
  if (!value || value.length > 253) return null;
  if (IPV4.test(value) || value === 'localhost') return value;
  return /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/.test(value)
    ? value
    : null;
}

export function hostMatchesDomain(host: string, domain: string): boolean {
  const h = host.toLowerCase();
  const d = domain.toLowerCase();
  return h === d || h.endsWith(`.${d}`);
}

export function parseHttpUrl(url: string | undefined | null): URL | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null;
  } catch {
    return null;
  }
}

/** The app a URL belongs to; the most specific domain wins when several apps match. */
export function appForUrl<T extends Pick<AppDef, 'domains'>>(
  apps: readonly T[],
  url: string | undefined | null,
): T | null {
  const parsed = parseHttpUrl(url);
  if (!parsed) return null;
  let best: T | null = null;
  let bestLength = -1;
  for (const app of apps) {
    for (const domain of app.domains) {
      if (hostMatchesDomain(parsed.hostname, domain) && domain.length > bestLength) {
        best = app;
        bestLength = domain.length;
      }
    }
  }
  return best;
}

/** Match patterns covering the app's domains and their subdomains, over http and https. */
export function matchPatterns(app: Pick<AppDef, 'domains'>): string[] {
  const patterns = new Set<string>();
  for (const domain of app.domains) {
    patterns.add(isIpOrLocal(domain) ? `*://${domain}/*` : `*://*.${domain}/*`);
  }
  return [...patterns];
}

/** The URL chrome.cookies needs to read, set or remove a cookie. */
export function cookieUrl(cookie: Pick<CookieRecord, 'domain' | 'path' | 'secure'>): string {
  const host = cookie.domain.replace(/^\./, '');
  return `${cookie.secure ? 'https' : 'http'}://${host}${cookie.path || '/'}`;
}

export function originOf(url: string): string | null {
  return parseHttpUrl(url)?.origin ?? null;
}

/** Drops a trailing slash-only path so "https://x.com/" and "https://x.com" compare equal. */
export function displayUrl(url: string): string {
  const parsed = parseHttpUrl(url);
  if (!parsed) return url;
  const path = parsed.pathname === '/' ? '' : parsed.pathname;
  return `${parsed.host}${path}${parsed.search}`;
}
