import { ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { VAULT_NUDGE_SNOOZE_MS, vaultNudgeDue } from '../core/settings';
import type { Account, Settings, VaultMeta } from '../core/types';
import { send } from '../shared/protocol';
import { Callout } from './controls';
import { useI18n } from './i18n';

/** Asks to lock saved sessions with a passphrase while none is set ("Later" hides it for two weeks). */
export function VaultNudge({
  settings,
  vault,
  accounts,
  onOpen,
}: {
  settings: Settings;
  vault: VaultMeta | null;
  accounts: readonly Account[];
  onOpen: () => void;
}) {
  const { t } = useI18n();
  const [now] = useState(() => Date.now());
  const saved = accounts.filter((account) => account.capturedAt).length;
  if (!vaultNudgeDue(settings, Boolean(vault), saved, now)) return null;
  return (
    <Callout
      tone="warning"
      icon={<ShieldAlert aria-hidden="true" />}
      title={t('vault.nudgeTitle')}
      actions={
        <>
          <button type="button" className="btn btn--primary btn--sm" onClick={onOpen}>
            {t('vault.nudgeAction')}
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => void send('settings.update', { patch: { vaultNudgeUntil: now + VAULT_NUDGE_SNOOZE_MS } })}
          >
            {t('vault.nudgeLater')}
          </button>
        </>
      }
    >
      {t('vault.nudgeBody', { n: saved })}
    </Callout>
  );
}
