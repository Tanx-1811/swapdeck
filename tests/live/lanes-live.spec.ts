/**
 * Live check of separate tabs (lanes) against the real sites (needs the network; not run in CI):
 * for every preset, open its home page in an ordinary tab, then in a scratch separate tab, and
 * compare. The lane's page script runs on every page of the app there, so it must not break
 * anything: the page loads, the lane is in force on the app's own pages (its `Server-Timing`
 * entry reached the page), nothing throws there that didn't throw in the ordinary tab, and the
 * page shows about as much as it did. Then the ordinary tab loads again while that lane exists
 * (the page script runs there too, hiding the lane's names) and must look as it did the first
 * time. Signed out, in a throwaway profile.
 *
 *   npm run build:e2e && npx playwright test --project=live lanes-live
 *   LIVE_ONLY=supabase,vercel npx playwright test --project=live lanes-live
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import { PRESETS } from '../../src/core/presets';
import { presetToInput } from '../../src/shared/apps';
import { expect, test } from '../e2e/fixtures';

const only = process.env.LIVE_ONLY?.split(',').filter(Boolean);
const presets = only ? PRESETS.filter((preset) => only.includes(preset.id)) : PRESETS;
const BATCH = 12;
const SETTLE_MS = 4_000;
const SW_REFUSED = 'Service workers are off in a separate tab';
/**
 * Errors a site throws by itself, from a race in its own code that a reload with different timing
 * sets off — checked to be no fault of separate tabs. They count as notes, not problems.
 *
 * - Trello: react-google-recaptcha-v3 clears `___grecaptcha_cfg` while recaptcha__en.js is still
 *   starting. It happens on a reload of a tab that loaded the page before, even once the lane is
 *   closed and no listener, page script or rule of Swapdeck is left; reCAPTCHA still hands out
 *   tokens afterwards.
 */
const SITE_RACES: { id: string; message: RegExp }[] = [
  { id: 'trello', message: /^Missing required parameters: sitekey$/ },
];
const siteRace = (id: string, message: string) =>
  SITE_RACES.some((race) => race.id === id && race.message.test(message));

type Look = {
  url: string;
  title: string;
  text: number;
  errors: string[];
  /** Requests to the app's own sites that failed (method + address without the query). */
  failed: string[];
  /** Requests to the app's own sites that got an answer. */
  answered: string[];
  lane: boolean | null;
};
type Watch = { errors: string[]; stacks: string[]; failed: string[]; answered: string[] };

const requestKey = (method: string, address: string) => {
  const url = new URL(address);
  return `${method} ${url.origin}${url.pathname}`;
};

/** Collects what goes wrong on a page from now on. */
function watch(page: Page, domains: string[]): Watch {
  const seen: Watch = { errors: [], stacks: [], failed: [], answered: [] };
  page.on('pageerror', (error) => {
    seen.errors.push(error.message);
    seen.stacks.push((error.stack ?? error.message).split('\n').slice(0, 4).join(' ← '));
  });
  page.on('requestfailed', (request) => {
    if (!onAppDomain(request.url(), domains)) return;
    // Aborted on purpose (navigations, the page's own cancels) is not a failure.
    if (/ERR_ABORTED/.test(request.failure()?.errorText ?? '')) return;
    seen.failed.push(requestKey(request.method(), request.url()));
  });
  page.on('requestfinished', (request) => {
    if (onAppDomain(request.url(), domains)) seen.answered.push(requestKey(request.method(), request.url()));
  });
  return seen;
}

/** Error text without the parts that change between two loads of the same page. */
function normalize(message: string) {
  return message
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/\b[0-9a-f]{8,}\b/gi, '<hex>')
    .replace(/\d+/g, '<n>')
    .slice(0, 200);
}

function onAppDomain(url: string, domains: string[]) {
  try {
    const host = new URL(url).hostname;
    return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

async function look(page: Page, seen0: Watch): Promise<Look> {
  await page.waitForLoadState('load', { timeout: 25_000 }).catch(() => undefined);
  await page.waitForTimeout(SETTLE_MS);
  // Sites that redirect from script (to their sign-in page) may still be on their way: wait until
  // the address stays the same for two seconds, at most ten more seconds.
  for (let stable = 0, waited = 0, last = page.url(); stable < 4 && waited < 10_000; waited += 500) {
    await page.waitForTimeout(500);
    stable = page.url() === last ? stable + 1 : 0;
    last = page.url();
  }
  await page.waitForLoadState('load', { timeout: 10_000 }).catch(() => undefined);
  const seen = await page
    .evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      return {
        title: document.title,
        text: document.body?.innerText.length ?? 0,
        lane: nav ? (nav.serverTiming ?? []).some((entry) => entry.name === 'swapdeck-lane') : null,
      };
    })
    .catch(() => ({ title: '', text: 0, lane: null }));
  return {
    url: page.url(),
    ...seen,
    errors: [...seen0.errors],
    failed: [...new Set(seen0.failed)],
    answered: [...new Set(seen0.answered)],
  };
}

async function ordinary(context: BrowserContext, url: string, domains: string[]) {
  const page = await context.newPage();
  const watched = watch(page, domains);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 }).catch(() => undefined);
  const seen = await look(page, watched);
  return { page, seen };
}

for (let start = 0; start < presets.length; start += BATCH) {
  const batch = presets.slice(start, start + BATCH);
  test(`separate tabs ${start + 1}–${start + batch.length}`, async ({ context, call, tabIdOf }) => {
    test.setTimeout(batch.length * 75_000);
    type Line = {
      id: string;
      ok: boolean;
      problems: string[];
      notes: string[];
      plain?: Omit<Look, 'errors' | 'answered'> & { errors: number };
      lane?: Omit<Look, 'errors' | 'answered'> & {
        errors: number;
        newErrors: string[];
        stacks: string[];
        newFailures: string[];
      };
    };
    /** Opens the preset in an ordinary tab, then in a scratch separate tab, and compares. */
    const check = async (preset: (typeof presets)[number]): Promise<Line> => {
      const line: Line = { id: preset.id, ok: false, problems: [], notes: [] };
      const added = await call<{ id: string }>('app.add', { app: presetToInput(preset) });
      if (!added.ok) {
        line.problems.push(`add: ${added.error}`);
        return line;
      }
      const appId = added.data!.id;
      const plain = await ordinary(context, preset.homeUrl, preset.domains);
      const { answered: _plainAnswered, ...plainSeen } = plain.seen;
      line.plain = { ...plainSeen, errors: plain.seen.errors.length };

      const opened = context.waitForEvent('page', { timeout: 30_000 });
      const result = await call<{ token: string; tabId: number }>('lane.open', {
        appId,
        accountId: null,
        tabId: await tabIdOf(plain.page).catch(() => undefined),
        url: preset.homeUrl,
      });
      if (!result.ok) {
        line.problems.push(`lane.open: ${result.error} ${(result as { detail?: string }).detail ?? ''}`.trim());
      } else {
        const page = await opened.catch(() => null);
        if (!page) line.problems.push('no lane tab');
        else {
          const watched = watch(page, preset.domains);
          const seen = await look(page, watched);
          const before = new Set(plain.seen.errors.map(normalize));
          // Separate tabs refuse service workers on purpose (their requests carry no tab); a site
          // that doesn't catch the refusal logs it, which is expected.
          const refused = seen.errors.filter((message) => message.includes(SW_REFUSED));
          if (refused.length) line.notes.push('service worker refused');
          const newAll = seen.errors.filter(
            (message) => !message.includes(SW_REFUSED) && !before.has(normalize(message)),
          );
          const newErrors = newAll.filter((message) => !siteRace(preset.id, message));
          if (newAll.length > newErrors.length) line.notes.push("the site's own race (separate tab)");
          // Requests to the app that were answered in the ordinary tab but failed here (CORS,
          // blocked…). A request that fails in both, or that the ordinary tab never made, says
          // nothing about separate tabs.
          const worked = new Set(plain.seen.answered.filter((request) => !plain.seen.failed.includes(request)));
          const newFailures = seen.failed.filter((request) => worked.has(request));
          const { answered: _answered, ...laneSeen } = seen;
          line.lane = { ...laneSeen, errors: seen.errors.length, newErrors, stacks: watched.stacks, newFailures };

          if (!/^https?:/.test(plain.seen.url) && !/^https?:/.test(seen.url))
            line.notes.push('site unreachable in both tabs');
          else if (!/^https?:/.test(seen.url)) line.problems.push(`lane page did not load (${seen.url})`);
          const onApp = onAppDomain(seen.url, preset.domains);
          if (onApp && seen.lane === false) line.problems.push('lane not in force on the app page');
          if (!onApp && /^https?:/.test(seen.url)) line.notes.push(`ended off the app's domains (${seen.url})`);
          // Errors only the separate tab had: the lane's script is the suspect.
          if (newErrors.length) line.problems.push(`new errors: ${newErrors.slice(0, 3).join(' | ')}`);
          if (newFailures.length) line.problems.push(`requests failed: ${newFailures.slice(0, 3).join(' | ')}`);
          // A page that renders much less there than in an ordinary tab broke somewhere.
          if (plain.seen.text > 200 && seen.text < plain.seen.text * 0.3)
            line.problems.push(`shows much less (${seen.text} vs ${plain.seen.text} characters)`);

          // The ordinary tab again, now that a lane of its app exists: the page script runs there
          // too (it only hides the lane's names) and must change nothing for the page.
          const watchedAgain = watch(plain.page, preset.domains);
          await plain.page.reload({ waitUntil: 'domcontentloaded', timeout: 25_000 }).catch(() => undefined);
          const again = await look(plain.page, watchedAgain);
          const againAll = again.errors.filter((message) => !before.has(normalize(message)));
          const againErrors = againAll.filter((message) => !siteRace(preset.id, message));
          if (againAll.length > againErrors.length) line.notes.push("the site's own race on reload (ordinary tab)");
          const againFailures = again.failed.filter((request) => worked.has(request));
          if (againErrors.length)
            line.problems.push(`ordinary tab, new errors: ${againErrors.slice(0, 3).join(' | ')}`);
          if (againFailures.length)
            line.problems.push(`ordinary tab, requests failed: ${againFailures.slice(0, 3).join(' | ')}`);
          if (plain.seen.text > 200 && again.text < plain.seen.text * 0.3)
            line.problems.push(`ordinary tab shows much less (${again.text} vs ${plain.seen.text} characters)`);
        }
        await call('lane.close', { token: result.data!.token });
      }
      await plain.page.close().catch(() => undefined);
      await call('app.remove', { id: appId });
      line.ok = line.problems.length === 0;
      return line;
    };

    const report: Line[] = [];
    for (const preset of batch) {
      let line = await check(preset);
      // Live sites have bad moments (a slow redirect, a flaky endpoint): a problem counts when it
      // shows up twice in a row.
      if (!line.ok) {
        const first = line.problems.join('; ');
        line = await check(preset);
        if (line.ok) line.notes.push(`passed on a second try (first: ${first})`);
      }
      report.push(line);
    }
    const file = resolve(import.meta.dirname, `../../test-results/lanes-live-${start + 1}.json`);
    writeFileSync(file, JSON.stringify(report, null, 2));
    for (const line of report)
      console.log(
        `${line.ok ? '✓' : '✗'} ${line.id.padEnd(16)} ${[...line.problems, ...line.notes.map((note) => `(${note})`)].join('; ')}`,
      );
    expect(report.filter((line) => !line.ok).map((line) => `${line.id}: ${line.problems.join('; ')}`)).toEqual([]);
  });
}
