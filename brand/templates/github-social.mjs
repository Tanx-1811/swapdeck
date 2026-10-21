// GitHub repository social preview, 1280 × 640 (content kept inside a 40 px safe area).
import { COPY, deckHtml, FONTS, NAME, page, PALETTE, tilesHtml } from './shared.mjs';

export const width = 1280;
export const height = 640;
export const outputs = { en: 'social/github-social-1280x640.png' };

export function html({ lockup, lang = 'en' }) {
  const copy = COPY[lang];
  const lockupHeight = 46;

  const css = `
.copy-block { position: absolute; left: 96px; top: 0; bottom: 0; width: 620px;
  display: flex; flex-direction: column; justify-content: center; }
.lockup { display: block; height: ${lockupHeight}px; width: ${Math.round(lockupHeight * lockup.light.ratio)}px; }
.headline { margin-top: 44px; font-size: 66px; line-height: 1.03; color: ${PALETTE.ink}; }
.sub { margin-top: 22px; font: 400 21px/1.5 ${FONTS.text}; color: ${PALETTE.ink2}; white-space: nowrap; }
.tiles { margin-top: 32px; }
.details { margin-top: 26px; display: flex; gap: 22px; font: 400 14px/1 ${FONTS.mono}; color: ${PALETTE.ink3}; }
.details span + span::before { content: '·'; margin-right: 22px; color: ${PALETTE.line}; }
`;

  const body = `<div class="bg"></div>
<div class="copy-block">
  <img class="lockup" src="${lockup.light.src}" alt="${NAME}">
  <h1 class="headline display">${copy.headline}</h1>
  <p class="sub">${copy.sub}</p>
  ${tilesHtml({ lang })}
  <p class="details">${copy.details.map((item) => `<span>${item}</span>`).join('')}</p>
</div>
${deckHtml({
  lang,
  x: 830,
  y: 250,
  scale: 0.98,
  fan: [
    [-2, 0, 0],
    [-7, -70, -14],
    [-12, -136, -22],
  ],
})}`;

  return page({ width, height, css, body, lang, theme: 'paper' });
}
