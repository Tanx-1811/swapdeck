// Shared building blocks for every Swapdeck brand image.
// Identity "Sơn mài & giấy dó" (lacquer & paper): warm paper and black lacquer,
// ink type, gold leaf and one vermilion seal. Everything here is plain strings
// (SVG / HTML / CSS); fonts are embedded from node_modules/@fontsource, so the
// templates render offline and identically on any machine.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

export const PALETTE = {
  // Paper (light) — "giấy dó"
  paper: '#F4F0E8',
  card: '#FBF9F5',
  sunken: '#EDE7DC',
  hairline: '#E1D9CB',
  line: '#CBBFAB',
  ink: '#1A1714',
  ink2: '#57504A',
  ink3: '#766D62',
  // Lacquer (dark) — "sơn mài"
  lacquer: '#141110',
  lacquer2: '#1C1816',
  lacquerLine: '#332B25',
  eggshell: '#F1E9DC',
  eggshell2: '#C2B6A5',
  // Accents
  son: '#C8402B', // vermilion: the seal, the one accent
  sonOnDark: '#E0573C',
  sonDeep: '#A8331E',
  jade: '#1F6B52',
  cham: '#2F4E86', // indigo
  gold: '#B08A3A', // gold leaf
  // The middle card of the mark's deck: eggshell one step darker than the front card.
  cardShade: '#D9CDB8',
};

export const FONTS = {
  display: "'Fraunces', Georgia, serif",
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
 * (tests/e2e/demo-data.ts), the one in use on top. Vermilion is kept for the
 * seal, so the top card's monogram is ink.
 */
export const DECK = {
  en: {
    inUse: 'In use',
    app: { name: 'Supabase', letter: 'S', color: '#3ECF8E', host: 'supabase.com' },
    cards: [
      { label: 'Company', email: 'minh@company.example', initials: 'CO', color: PALETTE.ink },
      { label: 'Personal', email: 'minh.home@example.com', initials: 'PE', color: PALETTE.cham },
      { label: 'Client — Acme', email: 'dev@acme.example', initials: 'CA', color: '#94661A' },
      { label: 'Side project', email: 'hello@sideproject.example', initials: 'SP', color: PALETTE.jade },
    ],
  },
  vi: {
    inUse: 'Đang dùng',
    app: { name: 'Supabase', letter: 'S', color: '#3ECF8E', host: 'supabase.com' },
    cards: [
      { label: 'Công ty', email: 'minh@company.example', initials: 'CT', color: PALETTE.ink },
      { label: 'Cá nhân', email: 'minh.home@example.com', initials: 'CN', color: PALETTE.cham },
      { label: 'Khách hàng — Acme', email: 'dev@acme.example', initials: 'KA', color: '#94661A' },
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
  { pkg: 'fraunces', weights: [600] },
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

// Geometry of the mark on a 128 × 128 grid (identical to assets/icon.svg):
// a black-lacquer tile holding a fanned deck — a gold-leaf card at the back,
// an eggshell card, and the paper card in front with two ink lines and the
// vermilion seal stamped in its corner.
const TILE = 'width="128" height="128" rx="28"';
const EDGE = 'x="1.5" y="1.5" width="125" height="125" rx="26.5"';
const BACK_CARD = 'x="38" y="20" width="74" height="52" rx="9" transform="rotate(-14 75 46)"';
const MIDDLE_CARD = 'x="30" y="30" width="76" height="54" rx="9" transform="rotate(-6 68 57)"';
const FRONT_CARD = 'x="17" y="46" width="84" height="58" rx="10"';
const LINE_1 = 'x="28" y="59" width="34" height="7" rx="3.5"';
const LINE_2 = 'x="28" y="72" width="22" height="7" rx="3.5"';
const SEAL = 'transform="rotate(-8 80 87)"';
const SEAL_FRAME = 'x="64.5" y="77" width="31" height="20" rx="3.5"';
const SEAL_BAR = 'x="70.5" y="84" width="19" height="6" rx="1.5"';

function markShapes(id) {
  return `<defs>
    <linearGradient id="${id}-sheen" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${PALETTE.eggshell}" stop-opacity="0.1"/>
      <stop offset="0.45" stop-color="${PALETTE.eggshell}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect ${TILE} fill="${PALETTE.ink}"/>
  <rect ${TILE} fill="url(#${id}-sheen)"/>
  <rect ${EDGE} fill="none" stroke="${PALETTE.eggshell}" stroke-opacity="0.16" stroke-width="3"/>
  <rect ${BACK_CARD} fill="${PALETTE.gold}"/>
  <rect ${MIDDLE_CARD} fill="${PALETTE.cardShade}"/>
  <rect ${FRONT_CARD} fill="${PALETTE.card}"/>
  <rect ${LINE_1} fill="${PALETTE.ink}"/>
  <rect ${LINE_2} fill="${PALETTE.ink}" fill-opacity="0.35"/>
  <g ${SEAL}>
    <rect ${SEAL_FRAME} fill="none" stroke="${PALETTE.son}" stroke-width="3.5"/>
    <rect ${SEAL_BAR} fill="${PALETTE.son}"/>
  </g>`;
}

/** Full-colour mark. `id` keeps gradient ids unique when several marks share a document. */
export function markSvg({ id = 'sd-mark', title = NAME } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" aria-label="${title}">
  <title>${title}</title>
  ${markShapes(id)}
</svg>
`;
}

/**
 * Single-colour mark (no tints): the tile is solid `color` and the three
 * cards are cut out of it, separated by tile-coloured gaps; the ink lines and
 * the seal stay in the tile colour. Works on photos and coloured backgrounds.
 */
export function markMonoSvg({ color, id = 'sd-mark-mono', title = NAME }) {
  const gap = 'stroke="#FFFFFF" stroke-width="8" paint-order="stroke"';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" aria-label="${title}">
  <title>${title}</title>
  <defs>
    <mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="128" height="128">
      <rect ${TILE} fill="#FFFFFF"/>
      <rect ${BACK_CARD} fill="#000000"/>
      <rect ${MIDDLE_CARD} fill="#000000" ${gap}/>
      <rect ${FRONT_CARD} fill="#000000" ${gap}/>
      <rect ${LINE_1} fill="#FFFFFF"/>
      <rect ${LINE_2} fill="#FFFFFF"/>
      <g ${SEAL}>
        <rect ${SEAL_FRAME} fill="none" stroke="#FFFFFF" stroke-width="3.5"/>
        <rect ${SEAL_BAR} fill="#FFFFFF"/>
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

// Proportions on a 128-unit mark: wordmark 0.64 × mark in Fraunces SemiBold, gap 0.25 × mark.
export const LOCKUP = { markSize: 128, gap: 32, fontSize: 82, baseline: 91, letterSpacing: -1.2 };

export const LOCKUP_COLORS = {
  light: PALETTE.ink,
  dark: PALETTE.eggshell,
  // On the black-lacquer promo backgrounds.
  night: PALETTE.eggshell,
};

/** The family name resvg reads from brand/fonts/Fraunces-SemiBold-latin.ttf. */
export const WORDMARK_FAMILY = 'Fraunces SemiBold';

/**
 * Source SVG for a horizontal lockup, using live text. scripts/brand/render.mjs
 * converts the text to outlines so the published SVGs need no fonts.
 */
export function lockupSourceSvg({ variant, width = 1000 }) {
  const { markSize, gap, fontSize, baseline, letterSpacing } = LOCKUP;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${markSize}" viewBox="0 0 ${width} ${markSize}">
  ${markShapes(`sd-lockup-${variant}`)}
  <text x="${markSize + gap}" y="${baseline}" font-family="${WORDMARK_FAMILY}" font-weight="600" font-size="${fontSize}" letter-spacing="${letterSpacing}" fill="${LOCKUP_COLORS[variant]}">${NAME}</text>
</svg>
`;
}

/** Inline an SVG string as an <img> source without id collisions. */
export function svgDataUri(svg) {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

/* ------------------------------------------------------------------ */
/* Textures                                                            */
/* ------------------------------------------------------------------ */

function svgUrl(svg) {
  return `url("data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}")`;
}

// A very fine paper grain: grey fractal noise around 50 % (in sRGB), blended
// with overlay so it adds texture without shifting the background colour.
const GRAIN = svgUrl(
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><filter id="g" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="3" stitchTiles="stitch"/><feColorMatrix values="1 0 0 0 0  1 0 0 0 0  1 0 0 0 0  0 0 0 0 1"/></filter><rect width="240" height="240" filter="url(#g)"/></svg>',
);

// Alpha mask for the seal: mostly opaque, with the speckles of uneven stamp ink.
const INK = svgUrl(
  '<svg xmlns="http://www.w3.org/2000/svg" width="90" height="90"><filter id="i" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency=".7" numOctaves="2" seed="11" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  -2.2 0 0 0 2.15"/></filter><rect width="90" height="90" filter="url(#i)"/></svg>',
);

/* ------------------------------------------------------------------ */
/* Deck of account cards (the product's core idea)                     */
/* ------------------------------------------------------------------ */

// One index card per saved account: monogram, name and email in the head,
// a vermilion head rule and ruled lines below, like a library card. The
// account in use sits on top of the deck with the site it belongs to,
// stamped with the seal.
export const CARD = { width: 380, height: 214 };

export const DECK_CSS = `
.deck { position: absolute; width: ${CARD.width}px; height: ${CARD.height}px; transform-origin: 0 0; }
.ic-card { position: absolute; left: 0; top: 0; width: ${CARD.width}px; height: ${CARD.height}px; overflow: hidden;
  background: ${PALETTE.card}; border-radius: 14px; color: ${PALETTE.ink};
  box-shadow: inset 0 0 0 1px ${PALETTE.hairline}, 0 1px 1px rgba(26, 23, 20, .06), 0 26px 44px -26px rgba(26, 23, 20, .6); }
/* Cards further back in the deck are a shade darker. */
.ic-card.depth-1 { background: #F7F3EC; }
.ic-card.depth-2 { background: #F1ECE2; }
.ic-card.depth-3 { background: #EBE5D9; }
.ic-head { display: flex; align-items: center; gap: 14px; height: 78px; padding: 0 24px; }
.ic-mono { width: 44px; height: 44px; border-radius: 10px; display: grid; place-items: center; flex: none;
  color: ${PALETTE.eggshell}; font: 700 16px/1 ${FONTS.text}; letter-spacing: .04em; }
.ic-text { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
.ic-label { font: 600 19px/1.1 ${FONTS.text}; letter-spacing: -0.01em; white-space: nowrap; }
.ic-email { font: 400 13px/1.1 ${FONTS.mono}; color: ${PALETTE.ink2}; white-space: nowrap; }
.ic-rules { position: absolute; left: 0; right: 0; top: 78px; bottom: 0; border-top: 1.5px solid rgba(200, 64, 43, .72); }
.ic-rules i { display: block; height: 34px; border-bottom: 1px solid ${PALETTE.hairline}; }
.ic-site { position: absolute; left: 24px; top: 90px; display: flex; align-items: center; gap: 9px;
  font: 400 13px/1 ${FONTS.mono}; color: ${PALETTE.ink3}; }
.ic-site .t { width: 20px; height: 20px; border-radius: 5px; display: grid; place-items: center;
  font: 700 11px/1 ${FONTS.text}; color: ${PALETTE.ink}; }
.seal { display: inline-flex; align-items: center; padding: 7px 12px 6px 14px; border: 2.5px solid ${PALETTE.son};
  border-radius: 8px; color: ${PALETTE.son}; font: 700 13px/1 ${FONTS.text}; letter-spacing: .2em;
  text-transform: uppercase; transform: rotate(-2deg); background: rgba(200, 64, 43, .05); white-space: nowrap;
  /* Uneven ink, as from a real stamp. */
  -webkit-mask-image: ${INK}; mask-image: ${INK}; -webkit-mask-size: 90px; mask-size: 90px; }
.ic-card .seal { position: absolute; right: 24px; bottom: 24px; }
/* Only the monograms of the cards behind peek out of the fan. */
.ic-card:not(.depth-0) .ic-text { visibility: hidden; }
/* Shorter cards (one ruled line fewer) for small canvases. */
.deck.compact, .deck.compact .ic-card { height: ${CARD.height - 34}px; }
`;

function cardHtml(card, { depth, deck, transform: [rotate, dx, dy] }) {
  const { app } = deck;
  const top = depth === 0;
  return `<div class="ic-card depth-${depth}" style="transform: translate(${dx}px, ${dy}px) rotate(${rotate}deg)">
  <div class="ic-head">
    <span class="ic-mono" style="background:${card.color}">${card.initials}</span>
    <span class="ic-text"><span class="ic-label">${card.label}</span><span class="ic-email">${card.email}</span></span>
  </div>
  <div class="ic-rules"><i></i><i></i><i></i><i></i></div>
  ${
    top
      ? `<span class="ic-site"><span class="t" style="background:${app.color}">${app.letter}</span>${app.host}</span>
  <span class="seal">${deck.inUse}</span>`
      : ''
  }
</div>`;
}

/**
 * A deck of account cards, the one in use on top. `fan` lists
 * [rotation°, x, y] per card, from the top card to the back of the deck;
 * `compact` uses shorter cards.
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
.theme-lacquer .app { background: ${PALETTE.lacquer2}; color: ${PALETTE.eggshell}; box-shadow: inset 0 0 0 1px ${PALETTE.lacquerLine}; }
.theme-lacquer .app .t { box-shadow: inset 0 0 0 1px rgba(241, 233, 220, .18); }
.app.more { padding: 0 14px; font: 400 13px/1 ${FONTS.mono}; }
.theme-paper .app.more { color: ${PALETTE.ink2}; background: transparent; box-shadow: inset 0 0 0 1px ${PALETTE.line}; }
.theme-lacquer .app.more { color: ${PALETTE.eggshell2}; background: transparent; box-shadow: inset 0 0 0 1px ${PALETTE.lacquerLine}; }
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

export function backgroundCss(theme) {
  if (theme === 'lacquer') {
    // Black lacquer with a faint sheen where the light catches it.
    return `
.bg { position: absolute; inset: 0; overflow: hidden; background:
    radial-gradient(60% 80% at 80% 12%, rgba(241, 233, 220, .045) 0%, rgba(241, 233, 220, 0) 70%), ${PALETTE.lacquer}; }
.bg::before { content: ''; position: absolute; inset: 0; background-image: ${GRAIN}; opacity: .5; mix-blend-mode: overlay; }
`;
  }
  return `
.bg { position: absolute; inset: 0; overflow: hidden; background: ${PALETTE.paper}; }
.bg::before { content: ''; position: absolute; inset: 0; background-image: ${GRAIN}; opacity: 1; mix-blend-mode: overlay; }
`;
}

export function page({ width, height, css, body, transparent = false, lang = 'en', theme = 'paper' }) {
  const ink = theme === 'lacquer' ? PALETTE.eggshell : PALETTE.ink;
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<style>
  ${fontFacesCss()}
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${width}px; height: ${height}px; overflow: hidden;
    background: ${transparent ? 'transparent' : theme === 'lacquer' ? PALETTE.lacquer : PALETTE.paper}; }
  body { position: relative; font-family: ${FONTS.text}; color: ${ink}; -webkit-font-smoothing: antialiased; }
  .display { font-family: ${FONTS.display}; font-weight: 600; letter-spacing: -0.02em; }
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
