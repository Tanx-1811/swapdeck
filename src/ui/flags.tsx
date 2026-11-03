import { Clock } from 'lucide-react';
import type { Account } from '../core/types';
import { relativeTime } from '../i18n/translate';
import { useI18n } from './i18n';

/** "Expired": the site was found signed out while this account was in use. */
export function ExpiredFlag({ account }: { account: Pick<Account, 'expiredAt'> }) {
  const { t, language } = useI18n();
  if (!account.expiredAt) return null;
  return (
    <span
      className="flag-expired"
      title={t('account.expiredHint', { time: relativeTime(account.expiredAt, language) })}
    >
      <Clock aria-hidden="true" />
      {t('account.expiredTag')}
    </span>
  );
}
