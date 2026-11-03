/**
 * "Check for updates" (Help page; only when the user asks): the latest GitHub
 * release of Swapdeck, read from the public API (no sign-in, no data sent).
 */

export const REPOSITORY = 'Tanx-1811/swapdeck';
export const LATEST_RELEASE_API = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
export const RELEASES_PAGE = `https://github.com/${REPOSITORY}/releases/latest`;

const VERSION = /^v?(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/;

/** Numeric comparison of "1.10.0"-style versions: < 0, 0 or > 0 (an unreadable one counts as 0.0.0). */
export function compareVersions(a: string, b: string): number {
  const parts = (value: string) => (VERSION.exec(value.trim())?.slice(1) ?? ['0', '0', '0']).map(Number);
  const [x, y] = [parts(a), parts(b)];
  for (let index = 0; index < 3; index++) {
    if (x[index]! !== y[index]!) return x[index]! - y[index]!;
  }
  return 0;
}

export type ReleaseInfo = {
  /** The extension's version in the release (its zip's name, else the tag). */
  extension: string | null;
  /** Swapdeck Desktop's version in the release (its zip's name). */
  desktop: string | null;
  /** The release page (always on github.com/Tanx-1811/swapdeck). */
  url: string;
  publishedAt: string | null;
};

/** The parts of GitHub's release JSON that matter, validated (it comes from the network). */
export function parseRelease(value: unknown): ReleaseInfo | null {
  if (!value || typeof value !== 'object') return null;
  const release = value as Record<string, unknown>;
  const tag = typeof release.tag_name === 'string' ? release.tag_name : '';
  let extension = VERSION.test(tag) ? tag.replace(/^v/, '') : null;
  let desktop: string | null = null;
  for (const asset of Array.isArray(release.assets) ? release.assets : []) {
    const name = asset && typeof asset === 'object' ? (asset as Record<string, unknown>).name : null;
    if (typeof name !== 'string') continue;
    const app = /^swapdeck-desktop-(\d{1,4}\.\d{1,4}\.\d{1,4})\.zip$/.exec(name);
    const extensionZip = /^swapdeck-(\d{1,4}\.\d{1,4}\.\d{1,4})\.zip$/.exec(name);
    if (app) desktop = app[1]!;
    else if (extensionZip) extension = extensionZip[1]!;
  }
  if (!extension && !desktop) return null;
  const page = typeof release.html_url === 'string' ? release.html_url : '';
  const url = page.startsWith(`https://github.com/${REPOSITORY}/releases/`) ? page : RELEASES_PAGE;
  const publishedAt = typeof release.published_at === 'string' ? release.published_at : null;
  return { extension, desktop, url, publishedAt };
}
