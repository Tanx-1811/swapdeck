import { parseHttpUrl } from './domains';
import type { AppDef, RecentItem } from './types';

/** Recent items kept per account. */
export const RECENT_LIMIT = 6;

/** A recent item (e.g. a Supabase project) for a page URL, using the app's pattern. */
export function recentFor(app: AppDef, url: string, title: string | undefined): RecentItem | null {
  if (!app.recentPattern) return null;
  const parsed = parseHttpUrl(url);
  if (!parsed) return null;
  let match: RegExpExecArray | null;
  try {
    match = new RegExp(app.recentPattern).exec(parsed.pathname);
  } catch {
    return null;
  }
  if (!match?.[1]) return null;
  let clean = (title ?? '').trim();
  if (app.titleSuffix && clean.endsWith(app.titleSuffix)) clean = clean.slice(0, -app.titleSuffix.length).trim();
  // Titles like "Table editor | my-project" put the item name last.
  const parts = clean.split(/\s+[|·–—-]\s+/).filter(Boolean);
  const name = parts.length > 1 ? parts[parts.length - 1]! : clean;
  const generic = !name || name.toLowerCase() === app.name.toLowerCase();
  return { key: match[1], title: generic ? match[1] : name, url: parsed.origin + match[0], at: Date.now() };
}

export function upsertRecent(recents: readonly RecentItem[], item: RecentItem): RecentItem[] {
  const existing = recents.find((recent) => recent.key === item.key);
  // Keep a real name rather than replacing it with the bare key from an early title.
  const title = item.title === item.key && existing && existing.title !== existing.key ? existing.title : item.title;
  return [{ ...item, title }, ...recents.filter((recent) => recent.key !== item.key)].slice(0, RECENT_LIMIT);
}
