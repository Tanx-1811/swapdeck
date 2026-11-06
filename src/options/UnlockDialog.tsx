import { LockOpen } from 'lucide-react';
import { useState } from 'react';
import { send } from '../shared/protocol';
import { Dialog, Field, Spinner } from '../ui/controls';
import { errorText } from '../ui/hooks';
import { useI18n } from '../ui/i18n';

/**
 * Asks for the passphrase where the switch was asked for (no trip to Security):
 * `onDone(true)` once unlocked, `onDone(false)` when cancelled.
 */
export function UnlockDialog({ open, onDone }: { open: boolean; onDone: (unlocked: boolean) => void }) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onClose={() => onDone(false)} title={t('vault.locked')}>
      {open && <UnlockBody onDone={onDone} />}
    </Dialog>
  );
}

function UnlockBody({ onDone }: { onDone: (unlocked: boolean) => void }) {
  const { t } = useI18n();
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  return (
    <form
      className="editor"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!passphrase || working) return;
        setWorking(true);
        const result = await send('vault.unlock', { passphrase });
        setWorking(false);
        if (result.ok) onDone(true);
        else setError(result.error === 'BAD_PASSPHRASE' ? t('vault.wrong') : errorText(t, result));
      }}
    >
      <p className="dialog__text">{t('vault.lockedHint')}</p>
      <Field label={t('vault.passphrase')} htmlFor="unlock-passphrase" error={error}>
        <input
          id="unlock-passphrase"
          className="input"
          type="password"
          autoComplete="current-password"
          data-autofocus
          value={passphrase}
          aria-invalid={Boolean(error)}
          onChange={(event) => {
            setPassphrase(event.target.value);
            setError(null);
          }}
        />
      </Field>
      <div className="dialog__actions">
        <button type="button" className="btn" onClick={() => onDone(false)}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="btn btn--primary" disabled={!passphrase || working}>
          {working ? <Spinner /> : <LockOpen />} {t('common.unlock')}
        </button>
      </div>
    </form>
  );
}
