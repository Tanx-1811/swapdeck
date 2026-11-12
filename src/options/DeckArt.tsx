/**
 * The overview illustration: the deck of the logo drawn large — two saved accounts behind, the
 * one in use in front with its "In use" label. Flat colours from the theme (options.css,
 * `.deck-art`): no gradient, no sheen.
 */
export function DeckArt({ seal }: { seal: string }) {
  return (
    <svg className="deck-art" viewBox="0 0 260 190" width="260" height="190" aria-hidden="true" focusable="false">
      <rect className="deck-art__back" x="96" y="18" width="146" height="98" rx="14" />
      <rect className="deck-art__mid" x="68" y="40" width="158" height="104" rx="14" />
      <rect className="deck-art__front" x="38.5" y="62.5" width="179" height="113" rx="14" />
      <rect className="deck-art__avatar" x="56" y="80" width="34" height="34" rx="9" />
      <circle className="deck-art__person" cx="73" cy="93" r="6" />
      <path className="deck-art__person" d="M62 112.5c1.6-6.5 6-10 11-10s9.4 3.5 11 10z" />
      <rect className="deck-art__ink" x="102" y="84" width="72" height="8" rx="4" />
      <rect className="deck-art__faint" x="102" y="99" width="52" height="6" rx="3" />
      <rect className="deck-art__chip" x="56.5" y="132.5" width="40" height="14" rx="5" />
      <rect className="deck-art__chip" x="102.5" y="132.5" width="48" height="14" rx="5" />
      <rect className="deck-art__pill" x="56" y="153" width={Math.max(62, 28 + seal.length * 6)} height="16" rx="8" />
      <circle className="deck-art__dot" cx="66" cy="161" r="3" />
      <text className="deck-art__pill-text" x="74" y="164.5">
        {seal}
      </text>
    </svg>
  );
}
