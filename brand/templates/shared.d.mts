// Types for the parts of shared.mjs that TypeScript code (the store screenshot test) uses.
export const PALETTE: Record<
  | 'paper'
  | 'card'
  | 'sunken'
  | 'hairline'
  | 'line'
  | 'ink'
  | 'ink2'
  | 'ink3'
  | 'night'
  | 'night2'
  | 'nightLine'
  | 'onNight'
  | 'onNight2'
  | 'iris'
  | 'irisText'
  | 'irisSoft'
  | 'irisOnNight'
  | 'deckBack'
  | 'deckMid'
  | 'deckMidSmall'
  | 'jade'
  | 'cham'
  | 'amber',
  string
>;
export const FONTS: { display: string; text: string; mono: string };
/** @font-face rules for the brand fonts, with the woff2 files inlined. */
export function fontFacesCss(): string;
/** CSS for a flat `.bg` layer: light paper or the deep ink of the night variant. */
export function backgroundCss(theme: 'paper' | 'night'): string;
