import { useEffect, useState } from 'react';
import type { Account, AppDef } from '../core/types';
import { initials, readableTextColor } from '../core/util';
import { SymbolIcon } from './icons';

type Size = 'sm' | 'md' | 'lg';

const ICON_SIZE: Record<Size, number> = { sm: 13, md: 17, lg: 22 };

/**
 * An account's avatar, a small square like an ID photo: its picture from the
 * site, else its symbol, else its emoji (older versions), else initials.
 */
export function Avatar({
  account,
  size = 'md',
  showPicture = true,
}: {
  account: Pick<Account, 'label' | 'color' | 'emoji' | 'avatarUrl'> & { icon?: string };
  size?: Size;
  showPicture?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  const sizeClass = size === 'md' ? '' : ` avatar--${size}`;
  const solid = { background: account.color, color: readableTextColor(account.color) };
  if (account.icon) {
    return (
      <span className={`avatar avatar--icon${sizeClass}`} style={solid} aria-hidden="true">
        <SymbolIcon name={account.icon} size={ICON_SIZE[size]} />
      </span>
    );
  }
  if (account.emoji) {
    return (
      <span
        className={`avatar avatar--emoji${sizeClass}`}
        style={{ background: `${account.color}22` }}
        aria-hidden="true"
      >
        {account.emoji}
      </span>
    );
  }
  return (
    <span className={`avatar${sizeClass}`} style={solid} aria-hidden="true">
      {showPicture && account.avatarUrl && !broken ? (
        <img src={account.avatarUrl} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
      ) : (
        initials(account.label)
      )}
    </span>
  );
}

/** Chrome's cached icon for a site (needs the "favicon" permission). */
export function faviconUrl(pageUrl: string, size = 32): string {
  try {
    const url = new URL(chrome.runtime.getURL('/_favicon/'));
    url.searchParams.set('pageUrl', pageUrl);
    url.searchParams.set('size', String(size));
    return url.toString();
  } catch {
    return '';
  }
}

async function pixelSignature(src: string): Promise<string> {
  const image = new Image();
  image.src = src;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('no canvas');
  context.drawImage(image, 0, 0, 16, 16);
  return Array.from(context.getImageData(0, 0, 16, 16).data).join(',');
}

const genericSignatures = new Map<number, Promise<string>>();
const knownIcons = new Map<string, Promise<boolean>>();

/**
 * Whether Chrome has a real icon for the site. For sites it has never seen it
 * serves a generic globe, which is less helpful than the app's letter tile.
 */
function hasRealFavicon(pageUrl: string, size: number): Promise<boolean> {
  const src = faviconUrl(pageUrl, size);
  let known = knownIcons.get(src);
  if (!known) {
    let generic = genericSignatures.get(size);
    if (!generic) {
      generic = pixelSignature(faviconUrl('https://swapdeck-no-icon.invalid/', size));
      genericSignatures.set(size, generic);
    }
    known = Promise.all([pixelSignature(src), generic])
      .then(([mine, base]) => mine !== base)
      .catch(() => false);
    knownIcons.set(src, known);
  }
  return known;
}

/** An app's tile: the site's icon when Chrome has one, else its first letter on its color. */
export function AppIcon({
  app,
  size = 'md',
  favicon = true,
}: {
  app: Pick<AppDef, 'name' | 'color' | 'homeUrl'>;
  size?: Size;
  favicon?: boolean;
}) {
  const sizeClass = size === 'md' ? '' : ` app-icon--${size}`;
  const pixels = size === 'lg' ? 64 : 32;
  const src = favicon ? faviconUrl(app.homeUrl, pixels) : '';
  const [real, setReal] = useState<{ src: string; ok: boolean } | null>(null);
  useEffect(() => {
    if (!src) return;
    let alive = true;
    void hasRealFavicon(app.homeUrl, pixels).then((ok) => {
      if (alive) setReal({ src, ok });
    });
    return () => {
      alive = false;
    };
  }, [src, app.homeUrl, pixels]);
  if (src && real?.src === src && real.ok) {
    return (
      <span className={`app-icon app-icon--favicon${sizeClass}`} aria-hidden="true">
        <img src={src} alt="" />
      </span>
    );
  }
  return (
    <span
      className={`app-icon${sizeClass}`}
      style={{ background: app.color, color: readableTextColor(app.color) }}
      aria-hidden="true"
    >
      {Array.from(app.name)[0]?.toUpperCase()}
    </span>
  );
}
