// README header banner, 1600 × 500. A self-contained paper panel with a
// hairline edge and rounded, transparent corners, so it sits well on GitHub's
// light and dark themes.
import { COPY, deckHtml, FONTS, NAME, page, PALETTE } from './shared.mjs';

export const width = 1600;
export const height = 500;
export const outputs = { en: 'social/readme-banner-1600x500.png' };
export const transparent = true;

export function html({ lockup, lang = 'en' }) {
  const copy = COPY[lang];
  const lockupHeight = 46;

  const css = `
.frame { position: absolute; inset: 0; border-radius: 28px; overflow: hidden; }
.frame::after { content: ''; position: absolute; inset: 0; border-radius: 28px; box-shadow: inset 0 0 0 1.5px ${PALETTE.hairline}; }
.copy-block { position: absolute; left: 104px; top: 0; bottom: 0; width: 760px;
  display: flex; flex-direction: column; justify-content: center; }
.lockup { display: block; height: ${lockupHeight}px; width: ${Math.round(lockupHeight * lockup.light.ratio)}px; }
.headline { margin-top: 36px; font-size: 60px; line-height: 1.04; color: ${PALETTE.ink}; }
.sub { margin-top: 20px; font: 400 20px/1.55 ${FONTS.text}; color: ${PALETTE.ink2}; white-space: nowrap; }
`;

  const body = `<div class="frame">
<div class="bg"></div>
<div class="copy-block">
  <img class="lockup" src="${lockup.light.src}" alt="${NAME}">
  <h1 class="headline display">${copy.headline}</h1>
  <p class="sub">${copy.subOneLine}</p>
</div>
${deckHtml({
  lang,
  x: 1110,
  y: 168,
  scale: 0.98,
  fan: [
    [-2, 0, 0],
    [-7, -70, -14],
    [-12, -136, -22],
    [-17, -198, -24],
  ],
})}
</div>`;

  return page({ width, height, css, body, transparent: true, lang, theme: 'paper' });
}
