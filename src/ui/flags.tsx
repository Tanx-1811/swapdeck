import { AppWindow, Clock } from 'lucide-react';
import type { LaneSummary } from '../core/lane-registry';
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

/** "Separate tab": the account is open in tabs of its own, apart from the browser's other tabs. */
export function LaneFlag({ lane }: { lane: LaneSummary | undefined }) {
  const { t } = useI18n();
  if (!lane) return null;
  const count = lane.tabIds.length;
  return (
    <span
      className="flag-lane"
      title={`${t('lane.inTabs')} · ${t(count === 1 ? 'lane.tabs.one' : 'lane.tabs', { n: count })}`}
    >
      <AppWindow aria-hidden="true" />
      {t('lane.tag')}
    </span>
  );
}
