import { Archive } from 'lucide-react';
import { useState } from 'react';
import { BACKUP_NUDGE_SNOOZE_MS, backupNudgeDue } from '../core/settings';
import type { Account, Settings } from '../core/types';
import { relativeTime } from '../i18n/translate';
import { send } from '../shared/protocol';
import { Callout, Spinner, useToast } from './controls';
import { backupFileName, downloadText } from './download';
import { errorText } from './hooks';
import { useI18n } from './i18n';

/**
 * Suggests a backup when there is none yet (a few days after the first saved
 * account) or the last one is a month old. "Back up now" saves the list right
 * away (no sign-ins, so no password); "Later" waits two weeks.
 */
export function BackupNudge({ settings, accounts }: { settings: Settings; accounts: readonly Account[] }) {
  const { t, language } = useI18n();
  const notify = useToast();
  const [now] = useState(() => Date.now());
  const [working, setWorking] = useState(false);
  if (!backupNudgeDue(settings, accounts, now)) return null;
  return (
    <Callout
      tone="info"
      icon={<Archive aria-hidden="true" />}
      title={t('backup.nudgeTitle')}
      actions={
        <>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            disabled={working}
            onClick={async () => {
              setWorking(true);
              const result = await send('backup.export', { password: null, includeSessions: false });
              setWorking(false);
              if (!result.ok) {
                notify(errorText(t, result), 'error');
                return;
              }
              downloadText(result.data, backupFileName());
              notify(t('backup.quickDone'));
            }}
          >
            {working ? <Spinner /> : null} {t('backup.backupNow')}
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => void send('settings.update', { patch: { backupNudgeUntil: now + BACKUP_NUDGE_SNOOZE_MS } })}
          >
            {t('vault.nudgeLater')}
          </button>
        </>
      }
    >
      {settings.lastBackupAt
        ? t('backup.nudgeOld', { time: relativeTime(settings.lastBackupAt, language) })
        : t('backup.nudgeNever')}
    </Callout>
  );
}
