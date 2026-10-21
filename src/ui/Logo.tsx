import { useId } from 'react';

/**
 * The Swapdeck mark — a fanned deck of account cards on black lacquer, the top
 * card stamped with a vermilion seal: assets/icon.svg, or assets/icon-small.svg
 * (drawn on a 16-pixel grid) when shown at 24 px or less.
 */
export function LogoMark({ size = 24 }: { size?: number }) {
  const sheen = `sd-sheen-${useId().replace(/:/g, '')}`;
  if (size <= 24) {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <rect width="16" height="16" rx="3.5" fill="#1a1714" />
        <rect x="0.5" y="0.5" width="15" height="15" rx="3" fill="none" stroke="#f1e9dc" strokeOpacity="0.2" />
        <rect x="6" y="2" width="8" height="6" rx="1" fill="#b08a3a" />
        <rect x="4" y="4" width="10" height="6" rx="1" fill="#d9cdb8" />
        <rect x="2" y="6" width="11" height="8" rx="1" fill="#fbf9f5" />
        <rect x="4" y="8" width="5" height="1" fill="#1a1714" />
        <rect x="4" y="10" width="3" height="1" fill="#1a1714" fillOpacity="0.35" />
        <rect x="8" y="10" width="4" height="2" fill="#c8402b" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 128 128" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={sheen} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f1e9dc" stopOpacity="0.1" />
          <stop offset="0.45" stopColor="#f1e9dc" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="128" height="128" rx="28" fill="#1a1714" />
      <rect width="128" height="128" rx="28" fill={`url(#${sheen})`} />
      <rect
        x="1.5"
        y="1.5"
        width="125"
        height="125"
        rx="26.5"
        fill="none"
        stroke="#f1e9dc"
        strokeOpacity="0.16"
        strokeWidth="3"
      />
      <rect x="38" y="20" width="74" height="52" rx="9" fill="#b08a3a" transform="rotate(-14 75 46)" />
      <rect x="30" y="30" width="76" height="54" rx="9" fill="#d9cdb8" transform="rotate(-6 68 57)" />
      <rect x="17" y="46" width="84" height="58" rx="10" fill="#fbf9f5" />
      <rect x="28" y="59" width="34" height="7" rx="3.5" fill="#1a1714" />
      <rect x="28" y="72" width="22" height="7" rx="3.5" fill="#1a1714" fillOpacity="0.35" />
      <g transform="rotate(-8 80 87)">
        <rect x="64.5" y="77" width="31" height="20" rx="3.5" fill="none" stroke="#c8402b" strokeWidth="3.5" />
        <rect x="70.5" y="84" width="19" height="6" rx="1.5" fill="#c8402b" />
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
