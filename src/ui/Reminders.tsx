import { useState } from 'react';
import { vaultNudgeDue } from '../core/settings';
import type { Account, Settings, VaultMeta } from '../core/types';
import { BackupNudge } from './BackupNudge';
import { VaultNudge } from './VaultNudge';

/** One reminder at a time: lock the saved sessions first, then back them up. */
export function Reminders({
  settings,
  vault,
  accounts,
  onOpenSecurity,
}: {
  settings: Settings;
  vault: VaultMeta | null;
  accounts: readonly Account[];
  onOpenSecurity: () => void;
}) {
  const [now] = useState(() => Date.now());
  const saved = accounts.filter((account) => account.capturedAt).length;
  if (vaultNudgeDue(settings, Boolean(vault), saved, now)) {
    return <VaultNudge settings={settings} vault={vault} accounts={accounts} onOpen={onOpenSecurity} />;
  }
  return <BackupNudge settings={settings} accounts={accounts} />;
}
