import { ACCOUNT_COLORS, COLOR_NAMES } from '../core/util';
import { useI18n } from './i18n';

/**
 * The pigment palette as a radio group. `keep` (a color from an older version
 * or a site's brand color) stays offered first when it isn't in the palette.
 */
export function ColorPicker({
  label,
  value,
  onChange,
  keep,
  limit = ACCOUNT_COLORS.length,
}: {
  label: string;
  value: string;
  onChange: (color: string) => void;
  keep?: string;
  limit?: number;
}) {
  const { t } = useI18n();
  const palette = ACCOUNT_COLORS.slice(0, limit);
  const colors = keep && !palette.includes(keep) ? [keep, ...palette] : palette;
  const nameOf = (color: string) => {
    const name = COLOR_NAMES[color];
    return name ? t(`color.${name}`) : color.toUpperCase();
  };
  return (
    <div className="field">
      <span className="field__label">{label}</span>
      <div className="swatches" role="radiogroup" aria-label={label}>
        {colors.map((item) => (
          <button
            key={item}
            type="button"
            role="radio"
            aria-checked={value === item}
            aria-label={nameOf(item)}
            title={nameOf(item)}
            className="swatch swatch--color"
            style={{ background: item }}
            onClick={() => onChange(item)}
          />
        ))}
      </div>
    </div>
  );
}
