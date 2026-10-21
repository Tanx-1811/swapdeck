// Chrome Web Store small promo tile, 440 × 280 (English and Vietnamese).
// Kept simple and large: it is often shown at its native size.
import { COPY, deckHtml, NAME, page, PALETTE } from './shared.mjs';

export const width = 440;
export const height = 280;
export const outputs = {
  en: 'store/promo-small-440x280.png',
  vi: 'store/promo-small-440x280-vi.png',
};

export function html({ lockup, lang = 'en' }) {
  const copy = COPY[lang];
  const lockupHeight = 24;

  const css = `
.lockup { position: absolute; left: 28px; top: 24px; display: block; height: ${lockupHeight}px;
  width: ${Math.round(lockupHeight * lockup.light.ratio)}px; }
.headline { position: absolute; left: 28px; top: 62px; font-size: ${lang === 'vi' ? 25 : 28}px; line-height: 1.1; color: ${PALETTE.ink}; }
`;

  const body = `<div class="bg"></div>
<img class="lockup" src="${lockup.light.src}" alt="${NAME}">
<h1 class="headline display">${copy.headline}</h1>
${deckHtml({
  lang,
  x: 172,
  y: 146,
  scale: 0.6,
  compact: true,
  fan: [
    [-2, 0, 0],
    [-7, -66, -4],
    [-12, -128, -4],
  ],
})}`;

  return page({ width, height, css, body, lang, theme: 'paper' });
}
