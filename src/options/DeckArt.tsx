/**
 * The overview illustration: a fanned deck of account cards, the top one
 * stamped with the in-use seal, a vermilion sun and a few flakes of gold leaf
 * behind it. Colors come from the theme (options.css, `.deck-art`).
 */
export function DeckArt({ seal }: { seal: string }) {
  return (
    <svg className="deck-art" viewBox="0 0 260 190" width="260" height="190" aria-hidden="true" focusable="false">
      <circle className="deck-art__sun" cx="214" cy="46" r="38" />
      <rect className="deck-art__leaf" x="44" y="34" width="7" height="7" transform="rotate(24 47 37)" />
      <rect className="deck-art__leaf" x="226" y="128" width="5" height="5" transform="rotate(-18 228 130)" />
      <rect className="deck-art__leaf" x="30" y="150" width="4" height="4" transform="rotate(40 32 152)" />
      <rect className="deck-art__leaf" x="214" y="20" width="4" height="4" transform="rotate(12 216 22)" />
      <g transform="rotate(-13 140 84)">
        <rect className="deck-art__back" x="68" y="38" width="168" height="104" rx="12" />
      </g>
      <g transform="rotate(-6 132 96)">
        <rect className="deck-art__mid" x="54" y="48" width="168" height="104" rx="12" />
      </g>
      <g transform="rotate(1 124 112)">
        <rect className="deck-art__front" x="40" y="60" width="172" height="108" rx="12" />
        <rect className="deck-art__ink" x="56" y="76" width="30" height="30" rx="7" />
        <rect className="deck-art__paper" x="64" y="85" width="14" height="4" rx="2" />
        <rect className="deck-art__paper" x="64" y="93" width="9" height="4" rx="2" />
        <rect className="deck-art__ink" x="96" y="80" width="66" height="8" rx="4" />
        <rect className="deck-art__faint" x="96" y="94" width="46" height="6" rx="3" />
        <rect className="deck-art__chip" x="56.5" y="124.5" width="38" height="13" rx="4" />
        <rect className="deck-art__chip" x="99.5" y="124.5" width="48" height="13" rx="4" />
        <g transform="rotate(-8 176 140)">
          <rect className="deck-art__seal-box" x="142" y="130" width="68" height="20" rx="3" />
          <text className="deck-art__seal-text" x="176" y="143.5" textAnchor="middle">
            {seal.toUpperCase()}
          </text>
        </g>
      </g>
    </svg>
  );
}
