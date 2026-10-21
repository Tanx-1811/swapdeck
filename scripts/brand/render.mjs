#!/usr/bin/env node
// Regenerates every Swapdeck brand asset from the sources in brand/templates.
//
//   node scripts/brand/render.mjs                 # everything
//   node scripts/brand/render.mjs --only marquee  # one HTML template (by name)
//   node scripts/brand/render.mjs --html /tmp/x   # also write the composed HTML
//
// Logos are rendered with resvg; the wordmark is outlined from
// brand/fonts/Fraunces-SemiBold-latin.ttf (Fraunces 600, SIL OFL), so the
// published SVGs need no fonts. Promo and social images are rendered with
// Playwright's Chromium, with the brand fonts embedded from @fontsource.
// Both run fully offline, on any OS.
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { Resvg } from '@resvg/resvg-js';
import { LOCKUP, lockupSourceSvg, markMonoSvg, markSvg, NAME, svgDataUri } from '../../brand/templates/shared.mjs';
import * as githubSocial from '../../brand/templates/github-social.mjs';
import * as marquee from '../../brand/templates/promo-marquee.mjs';
import * as small from '../../brand/templates/promo-small.mjs';
import * as readmeBanner from '../../brand/templates/readme-banner.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BRAND = join(ROOT, 'brand');
const WORDMARK_FONT = join(BRAND, 'fonts', 'Fraunces-SemiBold-latin.ttf');
const TEMPLATES = { marquee, small, githubSocial, readmeBanner };

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const htmlDir = args.includes('--html') ? args[args.indexOf('--html') + 1] : null;
const written = [];

async function write(path, data) {
  const file = join(BRAND, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, data);
  written.push(file);
}

function pngInfo(buffer) {
  // IHDR: width, height, bit depth, colour type (2 = RGB, 6 = RGBA).
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    colorType: buffer[25],
  };
}

function renderSvg(svg, fitTo) {
  return new Resvg(svg, {
    fitTo,
    font: { loadSystemFonts: false, fontFiles: [WORDMARK_FONT] },
  })
    .render()
    .asPng();
}

/** Converts the lockup's live text to outlines and crops it to its content. */
function outlinedLockup(variant) {
  const options = { font: { loadSystemFonts: false, fontFiles: [WORDMARK_FONT] } };
  const box = new Resvg(lockupSourceSvg({ variant }), options).getBBox();
  if (!box) throw new Error(`Could not measure the ${variant} lockup`);
  const width = Math.ceil(box.x + box.width);
  const outlined = new Resvg(lockupSourceSvg({ variant, width }), options)
    .toString()
    .trim()
    // resvg drops accessibility metadata; put it back.
    .replace(/^<svg ([^>]*)>/, `<svg $1 role="img" aria-label="${NAME}">\n    <title>${NAME}</title>`);
  if (outlined.includes('<text')) throw new Error('Wordmark was not converted to outlines');
  return { svg: `${outlined}\n`, width, height: LOCKUP.markSize };
}

async function renderLogos() {
  if (!existsSync(WORDMARK_FONT)) {
    throw new Error(`Wordmark font not found at ${WORDMARK_FONT}.`);
  }

  const mark = markSvg();
  await write('logo/mark.svg', mark);
  await write('logo/mark-mono-white.svg', markMonoSvg({ color: '#FFFFFF' }));
  await write('logo/mark-mono-black.svg', markMonoSvg({ color: '#000000' }));
  await write('logo/mark-512.png', renderSvg(mark, { mode: 'width', value: 512 }));
  await write('logo/mark-1024.png', renderSvg(mark, { mode: 'width', value: 1024 }));

  const lockups = {};
  for (const variant of ['light', 'dark', 'night']) {
    const lockup = outlinedLockup(variant);
    lockups[variant] = lockup;
    const name = variant === 'night' ? 'lockup-horizontal-on-night' : `lockup-horizontal-${variant}`;
    await write(`logo/${name}.svg`, lockup.svg);
    await write(`logo/${name}@2x.png`, renderSvg(lockup.svg, { mode: 'width', value: 1200 }));
  }

  // Chrome Web Store icon: 96 × 96 artwork centred in 128 × 128 with 16 px of transparent padding.
  const markBody = mark.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  const storeIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><g transform="translate(16 16) scale(0.75)">${markBody}</g></svg>`;
  await write('store/store-icon-128.png', renderSvg(storeIcon, { mode: 'original' }));

  return lockups;
}

async function renderTemplates(lockups) {
  const assets = {
    lockup: Object.fromEntries(
      Object.entries(lockups).map(([variant, lockup]) => [
        variant,
        { src: svgDataUri(lockup.svg), ratio: lockup.width / lockup.height },
      ]),
    ),
    mark: svgDataUri(markSvg({ id: 'sd-mark-img' })),
  };

  const browser = await chromium.launch();
  try {
    for (const [name, template] of Object.entries(TEMPLATES)) {
      if (only && only !== name) continue;
      for (const [lang, output] of Object.entries(template.outputs)) {
        const html = template.html({ ...assets, lang });
        if (htmlDir) {
          await mkdir(htmlDir, { recursive: true });
          await writeFile(join(htmlDir, `${name}-${lang}.html`), html);
        }
        const page = await browser.newPage({
          viewport: { width: template.width, height: template.height },
          deviceScaleFactor: 1,
        });
        await page.setContent(html, { waitUntil: 'load' });
        await page.evaluate(() => document.fonts.ready);
        const png = await page.screenshot({ type: 'png', omitBackground: Boolean(template.transparent) });
        await page.close();
        await write(output, png);
      }
    }
  } finally {
    await browser.close();
  }
}

const lockups = await renderLogos();
await renderTemplates(lockups);

for (const file of written) {
  const size = (await stat(file)).size;
  let detail = '';
  if (file.endsWith('.png')) {
    const { width, height, colorType } = pngInfo(await readFile(file));
    detail = `${width}×${height} ${colorType === 2 ? 'RGB' : colorType === 6 ? 'RGBA' : `type ${colorType}`}`;
  }
  const warn = size > 1024 * 1024 ? '  ⚠ over 1 MB' : '';
  console.log(`${relative(ROOT, file).padEnd(52)} ${String(Math.round(size / 1024)).padStart(5)} KB  ${detail}${warn}`);
}
