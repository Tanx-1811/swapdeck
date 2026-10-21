/**
 * Live check of every preset against the real site (needs the network; not run in CI):
 * add the app, open its home page, and run "sign in with another account", which
 * goes through the whole switch path (switching page with page scripts blocked,
 * capture, clear, restore, destination). Signed out, in a throwaway profile.
 *
 *   npm run build:e2e && npx playwright test --project=live
 *   LIVE_ONLY=supabase,vercel npx playwright test --project=live
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PRESETS } from '../../src/core/presets';
import { presetToInput } from '../../src/shared/apps';
import { expect, test } from '../e2e/fixtures';

const only = process.env.LIVE_ONLY?.split(',').filter(Boolean);
const presets = only ? PRESETS.filter((preset) => only.includes(preset.id)) : PRESETS;
const BATCH = 12;

for (let start = 0; start < presets.length; start += BATCH) {
  const batch = presets.slice(start, start + BATCH);
  test(`presets ${start + 1}–${start + batch.length}`, async ({ context, call, tabIdOf }) => {
    test.setTimeout(batch.length * 45_000);
    const report: { id: string; ok: boolean; error?: string; ms: number }[] = [];
    for (const preset of batch) {
      const started = Date.now();
      const added = await call<{ id: string }>('app.add', { app: presetToInput(preset) });
      if (!added.ok) {
        report.push({ id: preset.id, ok: false, error: `add: ${added.error}`, ms: 0 });
        continue;
      }
      const page = await context.newPage();
      await page.goto(preset.homeUrl, { waitUntil: 'domcontentloaded', timeout: 25_000 }).catch(() => undefined);
      const result = await call('fresh', { appId: added.data!.id, tabId: await tabIdOf(page).catch(() => -1) });
      report.push({
        id: preset.id,
        ok: result.ok,
        ...(result.ok
          ? {}
          : {
              error: `${result.error}${(result as { detail?: string }).detail ? ` ${(result as { detail?: string }).detail}` : ''}`,
            }),
        ms: Date.now() - started,
      });
      await page.close().catch(() => undefined);
      // Remove it again so the next preset starts from a clean slate.
      await call('app.remove', { id: added.data!.id });
    }
    const file = resolve(import.meta.dirname, `../../test-results/live-${start + 1}.json`);
    writeFileSync(file, JSON.stringify(report, null, 2));
    for (const line of report)
      console.log(`${line.ok ? '✓' : '✗'} ${line.id.padEnd(16)} ${String(line.ms).padStart(6)} ms ${line.error ?? ''}`);
    expect(report.filter((line) => !line.ok)).toEqual([]);
  });
}
