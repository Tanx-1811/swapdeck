import type { Account } from './types';

/** Account colors: distinct in light and dark themes, white text readable on all. */
/** Lacquer pigments (each keeps white text at WCAG AA): son, chàm, ngọc, nghệ, mận, lam, tím, rêu, đất nung… */
export const ACCOUNT_COLORS = [
  '#c8402b',
  '#2f4e86',
  '#1f6b52',
  '#94661a',
  '#8c2f55',
  '#3d6f8f',
  '#6b4f9e',
  '#55692a',
  '#9a4a2a',
  '#1f5f6b',
  '#a34d63',
  '#4a4440',
];

/** Toolbar badge and page toast color when something is off (white text stays readable). */
export const WARNING_COLOR = '#a85a12';

/** Each pigment's name (message key `color.<name>`), so swatches can be told apart without seeing them. */
export const COLOR_NAMES: Record<
  string,
  'son' | 'cham' | 'ngoc' | 'nghe' | 'man' | 'lam' | 'tim' | 'reu' | 'dat' | 'vit' | 'hong' | 'muc'
> = {
  '#c8402b': 'son',
  '#2f4e86': 'cham',
  '#1f6b52': 'ngoc',
  '#94661a': 'nghe',
  '#8c2f55': 'man',
  '#3d6f8f': 'lam',
  '#6b4f9e': 'tim',
  '#55692a': 'reu',
  '#9a4a2a': 'dat',
  '#1f5f6b': 'vit',
  '#a34d63': 'hong',
  '#4a4440': 'muc',
};

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
  const [r, g, b] = channels.map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

/** White text on dark colors, near-black on light ones (WCAG AA for normal text). */
export function readableTextColor(background: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(background)) return '#ffffff';
  return contrastRatio('#ffffff', background) >= 4.5 ? '#ffffff' : '#1a1714';
}

/** Symbols an account or workspace can wear instead of initials (drawn by src/ui/icons.tsx). */
export const ACCOUNT_ICONS = [
  'briefcase',
  'building',
  'house',
  'user',
  'users',
  'handshake',
  'store',
  'rocket',
  'code',
  'flask',
  'wrench',
  'shield',
  'globe',
  'star',
  'heart',
  'leaf',
  'palette',
  'graduation',
  'coffee',
  'bug',
] as const;

export type AccountIcon = (typeof ACCOUNT_ICONS)[number];

export function isAccountIcon(value: unknown): value is AccountIcon {
  return typeof value === 'string' && (ACCOUNT_ICONS as readonly string[]).includes(value);
}

export function newId(prefix: string): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(8));
  return `${prefix}_${Array.from(bytes, (byte) => byte.toString(36).padStart(2, '0'))
    .join('')
    .slice(0, 12)}`;
}

/** The first color not used yet by the given accounts, cycling when all are taken. */
export function nextColor(accounts: readonly Pick<Account, 'color'>[]): string {
  const used = new Set(accounts.map((account) => account.color));
  return ACCOUNT_COLORS.find((color) => !used.has(color)) ?? ACCOUNT_COLORS[accounts.length % ACCOUNT_COLORS.length]!;
}

/** "Ngọc Ánh" → "NA", "work" → "WO", "an@example.org" → "AN". */
export function initials(label: string): string {
  const text = label.split('@')[0]!.trim();
  const words = text.split(/[\s._-]+/).filter(Boolean);
  if (words.length >= 2) return (firstChar(words[0]!) + firstChar(words[1]!)).toUpperCase();
  const chars = Array.from(words[0] ?? '?').map(firstChar);
  return (chars.slice(0, 2).join('') || '?').toUpperCase();
}

/** First letter without accents ("Ánh" → "A"), keeping letters like "Đ". */
function firstChar(word: string): string {
  const char = Array.from(word)[0] ?? '';
  return char.normalize('NFD').replace(/[\u0300-\u036f]/g, '') || char;
}

/** A readable default label for a new account. */
export function defaultLabel(identity: { email?: string; name?: string } | null | undefined, fallback: string): string {
  if (identity?.name && identity.name.length <= 40 && !identity.name.includes('@')) return identity.name;
  if (identity?.email) return identity.email.split('@')[0]!;
  return fallback;
}

/** Moves the item with `id` to `index`, renumbering `order` from 0. */
export function reorder<T extends { id: string; order: number }>(items: readonly T[], ids: readonly string[]): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const ordered = ids.map((id) => byId.get(id)).filter((item): item is T => Boolean(item));
  for (const item of items) if (!ids.includes(item.id)) ordered.push(item);
  return ordered.map((item, order) => ({ ...item, order }));
}

export function byOrder<T extends { order: number }>(a: T, b: T): number {
  return a.order - b.order;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Approximate byte size of a JSON-able value, for showing how big a saved session is. */
export function jsonSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value) ?? '').length;
}
