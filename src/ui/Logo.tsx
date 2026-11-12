import { useId } from 'react';

const IRIS = '#5046e5';

/**
 * The Swapdeck mark — a deck of account cards on a flat iris tile, the account in use in front:
 * assets/icon.svg, or assets/icon-small.svg (drawn on a 16-pixel grid) when shown at 24 px or less.
 */
export function LogoMark({ size = 24 }: { size?: number }) {
  const clip = `sd-front-${useId().replace(/:/g, '')}`;
  if (size <= 24) {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <defs>
          <clipPath id={clip}>
            <rect x="2" y="6" width="8" height="8" rx="1.5" />
          </clipPath>
        </defs>
        <rect width="16" height="16" rx="3.5" fill={IRIS} />
        <rect x="7" y="2" width="7" height="7" rx="1.5" fill="#8a84f0" />
        <rect x="5" y="4" width="7" height="7" rx="1.5" fill="#a9a4f5" />
        <rect x="2" y="6" width="8" height="8" rx="1.5" fill="#ffffff" />
        <g clipPath={`url(#${clip})`} fill={IRIS}>
          <circle cx="6" cy="8.75" r="1.5" />
          <rect x="3.5" y="11" width="5" height="5" rx="2.5" />
        </g>
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 128 128" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={clip}>
          <rect x="21" y="48" width="60" height="60" rx="14" />
        </clipPath>
      </defs>
      <rect width="128" height="128" rx="28" fill={IRIS} />
      <rect x="51" y="20" width="56" height="56" rx="13" fill="#8a84f0" />
      <rect
        x="37"
        y="34"
        width="58"
        height="58"
        rx="13.5"
        fill="#bdb9f7"
        stroke={IRIS}
        strokeWidth="4"
        paintOrder="stroke"
      />
      <rect
        x="21"
        y="48"
        width="60"
        height="60"
        rx="14"
        fill="#ffffff"
        stroke={IRIS}
        strokeWidth="4"
        paintOrder="stroke"
      />
      <g clipPath={`url(#${clip})`} fill={IRIS}>
        <circle cx="51" cy="70" r="11" />
        <rect x="30" y="86" width="42" height="30" rx="15" />
      </g>
    </svg>
  );
}

export function Logo({ size = 24 }: { size?: number }) {
  return (
    <span className="logo">
      <LogoMark size={size} />
      <span>Swapdeck</span>
    </span>
  );
}
