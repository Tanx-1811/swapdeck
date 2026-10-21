import { ACCOUNT_ICONS } from '../core/util';
import { useI18n } from './i18n';
import { ICONS } from './icons';

/** Initials or one of the symbols, as a radio group. */
export function IconPicker({ value, onChange }: { value: string; onChange: (icon: string) => void }) {
  const { t } = useI18n();
  return (
    <div className="field">
      <span className="field__label">{t('account.emoji')}</span>
      <div className="swatches" role="radiogroup" aria-label={t('account.emoji')}>
        <button
          type="button"
          role="radio"
          aria-checked={!value}
          className="swatch swatch--text"
          onClick={() => onChange('')}
        >
          {t('account.noEmoji')}
        </button>
        {ACCOUNT_ICONS.map((key) => {
          const Icon = ICONS[key];
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={value === key}
              aria-label={t(`icon.${key}`)}
              title={t(`icon.${key}`)}
              className="swatch swatch--icon"
              onClick={() => onChange(key)}
            >
              <Icon width={16} height={16} aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
