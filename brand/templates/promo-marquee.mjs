// Chrome Web Store marquee promo tile, 1400 × 560 (English and Vietnamese).
// The lacquer ("sơn mài") variant: paper cards on black lacquer.
import { COPY, deckHtml, FONTS, NAME, page, PALETTE, tilesHtml } from './shared.mjs';

export const width = 1400;
export const height = 560;
export const outputs = {
  en: 'store/promo-marquee-1400x560.png',
  vi: 'store/promo-marquee-1400x560-vi.png',
};

export function html({ lockup, lang = 'en' }) {
  const copy = COPY[lang];
  const lockupHeight = 44;

  const css = `
.copy-block { position: absolute; left: 96px; top: 0; bottom: 0; width: 640px;
  display: flex; flex-direction: column; justify-content: center; }
.lockup { display: block; height: ${lockupHeight}px; width: ${Math.round(lockupHeight * lockup.night.ratio)}px; }
.headline { margin-top: 40px; font-size: ${lang === 'vi' ? 56 : 64}px; line-height: 1.04; color: ${PALETTE.eggshell}; }
.sub { margin-top: 20px; font: 400 19px/1.55 ${FONTS.text}; color: ${PALETTE.eggshell2}; white-space: nowrap; }
.tiles { margin-top: 30px; }
`;

  const body = `<div class="bg"></div>
<div class="copy-block">
  <img class="lockup" src="${lockup.night.src}" alt="${NAME}">
  <h1 class="headline display">${copy.headline}</h1>
  <p class="sub">${copy.sub}</p>
  ${tilesHtml({ lang })}
</div>
${deckHtml({
  lang,
  x: 920,
  y: 214,
  scale: 1.04,
  fan: [
    [-2, 0, 0],
    [-7, -72, -14],
    [-12, -140, -22],
    [-17, -204, -24],
  ],
})}`;

  return page({ width, height, css, body, lang, theme: 'lacquer' });
}
