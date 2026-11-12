// Shared building blocks for every Swapdeck brand image.
// Identity: flat and quiet — cool grey paper, one ink, one iris accent. A deck
// of account cards, the one in use in front. No gradients, no sheen, no grain
// and no coloured edge strips. Everything here is plain strings (SVG / HTML /
// CSS); fonts are embedded from node_modules/@fontsource, so the templates
// render offline and identically on any machine.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

export const PALETTE = {
  // Light
  paper: '#F6F7FB',
  card: '#FFFFFF',
  sunken: '#EEF0F6',
  hairline: '#E3E5EE',
  line: '#CACEDC',
  ink: '#10121F',
  ink2: '#474D63',
  ink3: '#5F657B',
  // Night (dark promo backgrounds, the manager sidebar)
  night: '#16152B',
  night2: '#201E3B',
  nightLine: '#2E2B4F',
  onNight: '#F2F1FF',
  onNight2: '#A9A6CC',
  // Iris, the one accent
  iris: '#5046E5',
  irisText: '#4338CA',
  irisSoft: '#EEEDFE',
  irisOnNight: '#ACA8FF',
  // The deck of the mark: the cards behind the account in use, tints of iris.
  deckBack: '#8A84F0',
  deckMid: '#BDB9F7',
  deckMidSmall: '#A9A4F5',
  // Account colours of the demo data (tests/e2e/demo-data.ts)
  jade: '#1F6B52',
  cham: '#2F4E86',
  amber: '#94661A',
};

export const FONTS = {
  display: "'Be Vietnam Pro', system-ui, -apple-system, 'Segoe UI', sans-serif",
  text: "'Be Vietnam Pro', system-ui, -apple-system, 'Segoe UI', sans-serif",
  mono: "'JetBrains Mono', ui-monospace, Menlo, monospace",
};

export const NAME = 'Swapdeck';

/** Marketing copy per language. Keep claims honest: sessions stay on the device, sites are added one by one. */
export const COPY = {
  en: {
    headline: 'Switch accounts<br>in one click.',
    sub: 'Supabase, Vercel, GitHub and 160+ sites —<br>or every app of a client at once.',
    subOneLine: 'Supabase, Vercel, GitHub and 160+ sites — or every app of a client at once.',
    details: ['No signing out', 'Stays on your device', 'Passphrase lock'],
    more: '+160 sites',
  },
  vi: {
    headline: 'Đổi tài khoản<br>chỉ với một cú nhấp.',
    sub: 'Supabase, Vercel, GitHub và hơn 160 trang —<br>hoặc mọi ứng dụng của một bên cùng lúc.',
    subOneLine: 'Supabase, Vercel, GitHub và hơn 160 trang — hoặc mọi ứng dụng của một bên cùng lúc.',
    details: ['Không cần đăng xuất', 'Chỉ lưu trên máy bạn', 'Khóa bằng mật khẩu'],
    more: '+160 trang',
  },
};

/**
 * The illustrated deck: the Supabase accounts of the store screenshots
 * (tests/e2e/demo-data.ts), the one in use in front.
 */
export const DECK = {
  en: {
    inUse: 'In use',
    app: { name: 'Supabase', letter: 'S', color: '#3ECF8E', host: 'supabase.com' },
    cards: [
      { label: 'Company', email: 'minh@company.example', initials: 'CO', color: PALETTE.iris },
      { label: 'Personal', email: 'minh.home@example.com', initials: 'PE', color: PALETTE.cham },
      { label: 'Client — Acme', email: 'dev@acme.example', initials: 'CA', color: PALETTE.amber },
      { label: 'Side project', email: 'hello@sideproject.example', initials: 'SP', color: PALETTE.jade },
    ],
  },
  vi: {
    inUse: 'Đang dùng',
    app: { name: 'Supabase', letter: 'S', color: '#3ECF8E', host: 'supabase.com' },
    cards: [
      { label: 'Công ty', email: 'minh@company.example', initials: 'CT', color: PALETTE.iris },
      { label: 'Cá nhân', email: 'minh.home@example.com', initials: 'CN', color: PALETTE.cham },
      { label: 'Khách hàng — Acme', email: 'dev@acme.example', initials: 'KA', color: PALETTE.amber },
      { label: 'Dự án phụ', email: 'hello@sideproject.example', initials: 'DA', color: PALETTE.jade },
    ],
  },
};

/** Sites shown as plain letter tiles (names only, never third-party logos). */
export const APPS = [
  { name: 'Supabase', letter: 'S', color: '#3ECF8E', ink: PALETTE.ink },
  { name: 'Vercel', letter: 'V', color: '#171717', ink: '#FFFFFF' },
  { name: 'GitHub', letter: 'G', color: '#24292F', ink: '#FFFFFF' },
  { name: 'Netlify', letter: 'N', color: '#00AD9F', ink: PALETTE.ink },
  { name: 'Cloudflare', letter: 'C', color: '#F38020', ink: PALETTE.ink },
];

/* ------------------------------------------------------------------ */
/* Fonts (embedded as data URIs; Latin + Vietnamese subsets)           */
/* ------------------------------------------------------------------ */

const require = createRequire(import.meta.url);

const FONT_FILES = [
  { pkg: 'be-vietnam-pro', weights: [400, 600, 700] },
  { pkg: 'jetbrains-mono', weights: [400] },
];

let fontFaces;

/** @font-face rules for the brand fonts, with the woff2 files inlined. */
export function fontFacesCss() {
  if (fontFaces) return fontFaces;
  const rules = [];
  for (const { pkg, weights } of FONT_FILES) {
    const dir = dirname(require.resolve(`@fontsource/${pkg}/package.json`));
    for (const weight of weights) {
      const css = readFileSync(join(dir, `${weight}.css`), 'utf8');
      for (const subset of ['latin', 'vietnamese']) {
        const marker = `/* ${pkg}-${subset}-${weight}-normal */`;
        const start = css.indexOf(marker);
        if (start === -1) throw new Error(`Missing ${marker}`);
        const block = css.slice(start, css.indexOf('}', start) + 1);
        const file = /url\(\.\/files\/([^)]+\.woff2)\)/.exec(block)?.[1];
        if (!file) throw new Error(`No woff2 in ${marker}`);
        const data = readFileSync(join(dir, 'files', file)).toString('base64');
        rules.push(
          block
            .replace(/src:[^;]+;/, `src: url(data:font/woff2;base64,${data}) format('woff2');`)
            .replace('font-display: swap;', 'font-display: block;'),
        );
      }
    }
  }
  fontFaces = rules.join('\n');
  return fontFaces;
}

/* ------------------------------------------------------------------ */
/* Mark                                                                */
/* ------------------------------------------------------------------ */

// Geometry of the mark on a 128 × 128 grid (identical to assets/icon.svg and
// src/ui/Logo.tsx): a flat iris tile holding a deck of three account cards,
// stepped up and to the right — two tints of iris behind, the white card of
// the account in use in front with a person cut out of it. Thin tile-coloured
// gaps keep the cards apart.
const TILE = 'width="128" height="128" rx="28"';
const BACK_CARD = 'x="51" y="20" width="56" height="56" rx="13"';
const MIDDLE_CARD = 'x="37" y="34" width="58" height="58" rx="13.5"';
const FRONT_CARD = 'x="21" y="48" width="60" height="60" rx="14"';
const HEAD = 'cx="51" cy="70" r="11"';
const BODY = 'x="30" y="86" width="42" height="30" rx="15"';

function markShapes(id) {
  const gap = `stroke="${PALETTE.iris}" stroke-width="4" paint-order="stroke"`;
  return `<defs>
    <clipPath id="${id}-front"><rect ${FRONT_CARD}/></clipPath>
  </defs>
  <rect ${TILE} fill="${PALETTE.iris}"/>
  <rect ${BACK_CARD} fill="${PALETTE.deckBack}"/>
  <rect ${MIDDLE_CARD} fill="${PALETTE.deckMid}" ${gap}/>
  <rect ${FRONT_CARD} fill="#FFFFFF" ${gap}/>
  <g clip-path="url(#${id}-front)" fill="${PALETTE.iris}">
    <circle ${HEAD}/>
    <rect ${BODY}/>
  </g>`;
}

/** Full-colour mark. `id` keeps clip ids unique when several marks share a document. */
export function markSvg({ id = 'sd-mark', title = NAME } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" aria-label="${title}">
  <title>${title}</title>
  ${markShapes(id)}
</svg>
`;
}

/**
 * Single-colour mark (no tints): the tile is solid `color` and the three
 * cards are cut out of it, separated by tile-coloured gaps; the person stays
 * in the tile colour. Works on photos and coloured backgrounds.
 */
export function markMonoSvg({ color, id = 'sd-mark-mono', title = NAME }) {
  const gap = 'stroke="#FFFFFF" stroke-width="7" paint-order="stroke"';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" aria-label="${title}">
  <title>${title}</title>
  <defs>
    <clipPath id="${id}-front"><rect ${FRONT_CARD}/></clipPath>
    <mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="128" height="128">
      <rect ${TILE} fill="#FFFFFF"/>
      <rect ${BACK_CARD} fill="#000000"/>
      <rect ${MIDDLE_CARD} fill="#000000" ${gap}/>
      <rect ${FRONT_CARD} fill="#000000" ${gap}/>
      <g clip-path="url(#${id}-front)" fill="#FFFFFF">
        <circle ${HEAD}/>
        <rect ${BODY}/>
      </g>
    </mask>
  </defs>
  <rect ${TILE} fill="${color}" mask="url(#${id})"/>
</svg>
`;
}

/* ------------------------------------------------------------------ */
/* Lockup (mark + wordmark)                                            */
/* ------------------------------------------------------------------ */

// Proportions on a 128-unit mark: wordmark 0.62 × mark in Be Vietnam Pro Bold, gap 0.22 × mark.
export const LOCKUP = { markSize: 128, gap: 28, fontSize: 80, baseline: 92, letterSpacing: -2.4 };

export const LOCKUP_COLORS = {
  light: PALETTE.ink,
  dark: '#ECEDF5',
  // On the night promo backgrounds.
  night: PALETTE.onNight,
};

/** The family resvg reads from brand/fonts/BeVietnamPro-Bold-latin.ttf. */
export const WORDMARK_FAMILY = 'Be Vietnam Pro';

/**
 * Source SVG for a horizontal lockup, using live text. scripts/brand/render.mjs
 * converts the text to outlines so the published SVGs need no fonts.
 */
export function lockupSourceSvg({ variant, width = 1000 }) {
  const { markSize, gap, fontSize, baseline, letterSpacing } = LOCKUP;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${markSize}" viewBox="0 0 ${width} ${markSize}">
  ${markShapes(`sd-lockup-${variant}`)}
  <text x="${markSize + gap}" y="${baseline}" font-family="${WORDMARK_FAMILY}" font-weight="700" font-size="${fontSize}" letter-spacing="${letterSpacing}" fill="${LOCKUP_COLORS[variant]}">${NAME}</text>
</svg>
`;
}

/** Inline an SVG string as an <img> source without id collisions. */
export function svgDataUri(svg) {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

/* ------------------------------------------------------------------ */
/* Deck of account cards (the product's core idea)                     */
/* ------------------------------------------------------------------ */

// One white card per saved account: monogram, name and email; the account in
// use is in front with the site it belongs to and the "In use" label (a dot
// and a tinted pill). Cards behind are flat tints and show only their
// monogram. No rules, no coloured strips, no stamps.
export const CARD = { width: 380, height: 196 };

export const DECK_CSS = `
.deck { position: absolute; width: ${CARD.width}px; height: ${CARD.height}px; transform-origin: 0 0; }
.ic-card { position: absolute; left: 0; top: 0; width: ${CARD.width}px; height: ${CARD.height}px; overflow: hidden;
  background: ${PALETTE.card}; border-radius: 18px; color: ${PALETTE.ink};
  box-shadow: inset 0 0 0 1px ${PALETTE.hairline}, 0 18px 40px -24px rgba(16, 18, 31, .45); }
.theme-night .ic-card { box-shadow: 0 18px 40px -20px rgba(0, 0, 0, .6); }
/* Cards further back in the deck: flat tints of iris, as in the mark. */
.ic-card.depth-1 { background: #E4E2FD; }
.ic-card.depth-2 { background: #CFCBFA; }
.ic-card.depth-3 { background: #B9B4F6; }
.theme-night .ic-card.depth-1 { background: ${PALETTE.deckMid}; }
.theme-night .ic-card.depth-2 { background: #A39DF4; }
.theme-night .ic-card.depth-3 { background: ${PALETTE.deckBack}; }
.ic-head { display: flex; align-items: center; gap: 14px; height: 84px; padding: 0 24px; }
.ic-mono { width: 46px; height: 46px; border-radius: 12px; display: grid; place-items: center; flex: none;
  color: #FFFFFF; font: 700 16px/1 ${FONTS.text}; letter-spacing: .02em; }
.ic-text { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
.ic-label { font: 600 19px/1.1 ${FONTS.text}; letter-spacing: -0.01em; white-space: nowrap; }
.ic-email { font: 400 13px/1.1 ${FONTS.mono}; color: ${PALETTE.ink2}; white-space: nowrap; }
.ic-body { position: absolute; left: 24px; right: 24px; top: 84px; bottom: 24px;
  display: flex; flex-direction: column; justify-content: space-between; }
.ic-site { display: flex; align-items: center; gap: 9px; height: 34px; padding: 0 12px 0 7px; border-radius: 10px;
  background: ${PALETTE.sunken}; font: 400 13px/1 ${FONTS.mono}; color: ${PALETTE.ink2}; align-self: flex-start; }
.ic-site .t { width: 20px; height: 20px; border-radius: 6px; display: grid; place-items: center;
  font: 700 11px/1 ${FONTS.text}; color: ${PALETTE.ink}; }
.in-use { display: inline-flex; align-items: center; gap: 8px; height: 30px; padding: 0 14px 0 12px; border-radius: 999px;
  background: ${PALETTE.irisSoft}; color: ${PALETTE.irisText}; font: 600 14px/1 ${FONTS.text}; white-space: nowrap;
  align-self: flex-start; }
.in-use::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: ${PALETTE.iris}; }
/* Only the monograms of the cards behind show. */
.ic-card:not(.depth-0) .ic-text { visibility: hidden; }
/* Shorter cards for small canvases. */
.deck.compact, .deck.compact .ic-card { height: ${CARD.height - 30}px; }
.deck.compact .ic-site { display: none; }
`;

function cardHtml(card, { depth, deck, transform: [rotate, dx, dy] }) {
  const { app } = deck;
  const top = depth === 0;
  return `<div class="ic-card depth-${depth}" style="transform: translate(${dx}px, ${dy}px) rotate(${rotate}deg)">
  <div class="ic-head">
    <span class="ic-mono" style="background:${card.color}">${card.initials}</span>
    <span class="ic-text"><span class="ic-label">${card.label}</span><span class="ic-email">${card.email}</span></span>
  </div>
  ${
    top
      ? `<div class="ic-body"><span class="ic-site"><span class="t" style="background:${app.color}">${app.letter}</span>${app.host}</span>
  <span class="in-use">${deck.inUse}</span></div>`
      : ''
  }
</div>`;
}

/**
 * A deck of account cards, the one in use in front. `fan` lists
 * [rotation°, x, y] per card, from the front card to the back of the deck
 * (the brand steps them up and to the right, unrotated); `compact` uses
 * shorter cards.
 */
export function deckHtml({ lang = 'en', fan, x, y, scale = 1, compact = false }) {
  const deck = DECK[lang];
  const layers = fan.map((transform, depth) => cardHtml(deck.cards[depth], { depth, deck, transform }));
  return `<div class="deck${compact ? ' compact' : ''}" style="left:${x}px;top:${y}px;transform:scale(${scale})">
${layers.reverse().join('\n')}
</div>`;
}

/* ------------------------------------------------------------------ */
/* App tiles                                                           */
/* ------------------------------------------------------------------ */

export const TILES_CSS = `
.tiles { display: flex; flex-wrap: wrap; gap: 8px; }
.app { display: inline-flex; align-items: center; gap: 9px; height: 38px; padding: 0 14px 0 6px; border-radius: 10px;
  font: 600 14px/1 ${FONTS.text}; white-space: nowrap; }
.app .t { width: 26px; height: 26px; border-radius: 7px; display: grid; place-items: center; font: 700 13px/1 ${FONTS.text}; }
.theme-paper .app { background: ${PALETTE.card}; color: ${PALETTE.ink}; box-shadow: inset 0 0 0 1px ${PALETTE.hairline}; }
.theme-night .app { background: ${PALETTE.night2}; color: ${PALETTE.onNight}; box-shadow: inset 0 0 0 1px ${PALETTE.nightLine}; }
.app.more { padding: 0 14px; font: 400 13px/1 ${FONTS.mono}; }
.theme-paper .app.more { color: ${PALETTE.ink2}; background: transparent; box-shadow: inset 0 0 0 1px ${PALETTE.line}; }
.theme-night .app.more { color: ${PALETTE.onNight2}; background: transparent; box-shadow: inset 0 0 0 1px ${PALETTE.nightLine}; }
`;

export function tilesHtml({ lang = 'en', count = 3 }) {
  return `<div class="tiles">${APPS.slice(0, count)
    .map(
      (app) =>
        `<span class="app"><span class="t" style="background:${app.color};color:${app.ink}">${app.letter}</span>${app.name}</span>`,
    )
    .join('')}<span class="app more">${COPY[lang].more}</span></div>`;
}

/* ------------------------------------------------------------------ */
/* Page scaffolding                                                    */
/* ------------------------------------------------------------------ */

/** Flat backgrounds: `paper` (light) or `night` (the deep ink of the manager sidebar). */
export function backgroundCss(theme) {
  return `
.bg { position: absolute; inset: 0; overflow: hidden; background: ${theme === 'night' ? PALETTE.night : PALETTE.paper}; }
`;
}

export function page({ width, height, css, body, transparent = false, lang = 'en', theme = 'paper' }) {
  const ink = theme === 'night' ? PALETTE.onNight : PALETTE.ink;
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<style>
  ${fontFacesCss()}
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${width}px; height: ${height}px; overflow: hidden;
    background: ${transparent ? 'transparent' : theme === 'night' ? PALETTE.night : PALETTE.paper}; }
  body { position: relative; font-family: ${FONTS.text}; color: ${ink}; -webkit-font-smoothing: antialiased; }
  .display { font-family: ${FONTS.display}; font-weight: 700; letter-spacing: -0.03em; }
  ${backgroundCss(theme)}
  ${DECK_CSS}
  ${TILES_CSS}
  ${css}
</style>
</head>
<body class="theme-${theme}">
${body}
</body>
</html>`;
}
