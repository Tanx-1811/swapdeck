#!/usr/bin/env node
// Checks every built-in preset against the live sites (needs network):
//
//   node scripts/verify-presets.mjs              # all presets
//   node scripts/verify-presets.mjs github vercel # some presets, by id
//   node scripts/verify-presets.mjs --urls https://a.example/x https://b.example
//                                                # just follow redirects for URLs
//
// For each preset it requests the switching page (origin + stagingPath) and the
// home page, following up to 5 redirects by hand, and reports:
// - DNS / network failures and 4xx/5xx final answers (403 often means the site
//   blocks scripted requests: fine when the host is right),
// - redirects that leave the preset's domains (its sign-in may live on another
//   domain that should be listed too),
// - whether the switching page is HTML (allowed: the page's scripts are blocked
//   while switching, but a plain file is lighter).
// The presets are imported from the TypeScript source with Node's type stripping.
import { register } from 'node:module';

// Resolve extension-less relative imports ("./domains") to their .ts files.
register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, next) {
      if (/^\\.{1,2}\\//.test(specifier) && !/\\.[cm]?[jt]sx?$/.test(specifier)) {
        try { return await next(specifier + '.ts', context); } catch {}
      }
      return next(specifier, context);
    }`)}`,
);

const { PRESETS } = await import('../src/core/presets.ts');

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const TIMEOUT_MS = 12_000;
const MAX_HOPS = 5;
const CONCURRENCY = 8;

const hostMatches = (host, domain) => host === domain || host.endsWith(`.${domain}`);

/** Sign-in services shared by many sites: a redirect there is expected and never listed as a domain. */
const SHARED_SIGN_IN = [
  'api.workos.com',
  'signin.workos.com',
  'accounts.google.com',
  'appleid.apple.com',
  'login.microsoftonline.com',
];

/** Follows redirects by hand so every hop is visible. */
async function follow(url) {
  const hops = [];
  let current = url;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    let response;
    try {
      response = await fetch(current, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
          'accept-language': 'en-US,en;q=0.9,vi;q=0.8',
        },
      });
    } catch (error) {
      const cause = error?.cause?.code ?? error?.cause?.message ?? error?.name ?? String(error);
      return { hops, final: current, status: 0, error: cause };
    }
    hops.push({ url: current, status: response.status });
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      current = new URL(location, current).href;
      await response.body?.cancel();
      continue;
    }
    const type = (response.headers.get('content-type') ?? '').split(';')[0].trim();
    await response.body?.cancel();
    return { hops, final: current, status: response.status, type };
  }
  return { hops, final: current, status: 0, error: 'too many redirects' };
}

function describe(result, domains) {
  const notes = [];
  const left = result.hops
    .map((hop) => new URL(hop.url).hostname)
    .concat(new URL(result.final).hostname)
    .filter((host) => !domains.some((domain) => hostMatches(host, domain)) && !SHARED_SIGN_IN.includes(host));
  // Sign-in flows loop when no cookies are kept between hops; that's normal here.
  if (result.error === 'too many redirects' && !left.length) notes.push('sign-in redirect loop (needs cookies)');
  else if (result.error === 'UND_ERR_HEADERS_OVERFLOW') notes.push('very large headers (fine in Chrome)');
  else if (result.error) notes.push(`ERROR ${result.error}`);
  else if (result.status >= 400) notes.push(`HTTP ${result.status}`);
  if (left.length) notes.push(`LEAVES → ${[...new Set(left)].join(', ')}`);
  return notes;
}

async function pool(items, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await worker(items[index]);
      }
    }),
  );
  return results;
}

const args = process.argv.slice(2);

if (args[0] === '--urls') {
  const results = await pool(args.slice(1), (url) => follow(url));
  args.slice(1).forEach((url, index) => {
    const result = results[index];
    const chain = result.hops.map((hop) => `${hop.status} ${hop.url}`).join('\n    → ');
    console.log(
      `${url}\n    → ${chain || '(no answer)'}${result.error ? `\n    ✗ ${result.error}` : ''}${result.type ? `  [${result.type}]` : ''}`,
    );
  });
  process.exit(0);
}

const selected = args.length ? PRESETS.filter((preset) => args.includes(preset.id)) : PRESETS;
const rows = await pool(selected, async (preset) => {
  const staging = await follow(new URL(preset.stagingPath, preset.origin).href);
  const home = await follow(preset.homeUrl);
  const notes = [
    ...describe(staging, preset.domains).map((note) => `staging ${note}`),
    ...describe(home, preset.domains).map((note) => `home ${note}`),
  ];
  if (!staging.error && staging.status < 400 && /html/.test(staging.type ?? '')) notes.push('staging is HTML');
  // The switch checks that the switching page stayed on the main origin (a signed-out
  // visitor must not be sent to a sign-in host from there).
  const stagingOrigins = [...staging.hops.map((hop) => hop.url), staging.final].map((url) => new URL(url).origin);
  const elsewhere = stagingOrigins.find((origin) => origin !== preset.origin);
  if (elsewhere) notes.push(`staging ENDS ON ${elsewhere}`);
  return { preset, staging, home, notes };
});

let problems = 0;
const pad = (text, width) => String(text).padEnd(width).slice(0, width);
console.log(`${pad('preset', 18)} ${pad('category', 9)} ${pad('staging', 7)} ${pad('home', 5)} notes`);
for (const { preset, staging, home, notes } of rows) {
  // A missing staging file is fine (the page's scripts are blocked); a missing home page is not.
  const serious = notes.filter((note) => /ERROR|LEAVES|ENDS ON|home HTTP 5|home HTTP 404|home HTTP 410/.test(note));
  if (serious.length) problems++;
  console.log(
    `${serious.length ? '✗' : '✓'} ${pad(preset.id, 16)} ${pad(preset.category, 9)} ${pad(staging.status || '—', 7)} ${pad(home.status || '—', 5)} ${notes.join(' · ')}`,
  );
  if (serious.length && process.env.VERBOSE) {
    for (const [label, result] of [
      ['staging', staging],
      ['home', home],
    ]) {
      console.log(`    ${label}: ${result.hops.map((hop) => `${hop.status} ${hop.url}`).join(' → ')}`);
    }
  }
}
console.log(`\n${selected.length} presets checked, ${problems} with problems.`);
process.exit(problems ? 1 : 0);
