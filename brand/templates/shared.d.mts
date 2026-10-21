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
  | 'lacquer'
  | 'lacquer2'
  | 'lacquerLine'
  | 'eggshell'
  | 'eggshell2'
  | 'son'
  | 'sonOnDark'
  | 'sonDeep'
  | 'jade'
  | 'cham'
  | 'gold'
  | 'cardShade',
  string
>;
export const FONTS: { display: string; text: string; mono: string };
/** @font-face rules for the brand fonts, with the woff2 files inlined. */
export function fontFacesCss(): string;
/** CSS for a `.bg` layer: warm paper or black lacquer, with grain. */
export function backgroundCss(theme: 'paper' | 'lacquer'): string;
