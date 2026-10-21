import { KeyRound, Lock, LockOpen, ShieldAlert, ShieldCheck, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { AUTO_LOCK_CHOICES } from '../../core/settings';
import { Callout, Field, Spinner, useConfirm, useToast } from '../../ui/controls';
import { useI18n } from '../../ui/i18n';
import { useManager } from '../context';
import { Card, PageHeader } from '../Options';

/** 0–3: weak, fair, good, strong. A rough guide, not a guarantee. */
export function passphraseStrength(value: string): 0 | 1 | 2 | 3 {
  if (value.length < 8) return 0;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((regex) => regex.test(value)).length;
  const words = value.trim().split(/\s+/).length;
  let score = value.length >= 16 || words >= 4 ? 2 : value.length >= 12 ? 1 : 0;
  if (classes >= 3) score += 1;
  return Math.min(3, Math.max(value.length >= 10 ? 1 : 0, score)) as 0 | 1 | 2 | 3;
}

function StrengthMeter({ value }: { value: string }) {
  const { t } = useI18n();
  if (!value) return null;
  const strength = passphraseStrength(value);
  const labels = [
    t('security.strength.weak'),
    t('security.strength.fair'),
    t('security.strength.good'),
    t('security.strength.strong'),
  ];
  return (
    <div className={`strength strength--${strength}`} aria-live="polite">
      <span className="strength__bar">
        <span style={{ width: `${(strength + 1) * 25}%` }} />
      </span>
      <span>{labels[strength]}</span>
    </div>
  );
}

export function Security() {
  const { t } = useI18n();
  const { data, run, pending } = useManager();
  const notify = useToast();
  const confirm = useConfirm();
  const { state, unlocked } = data;

  return (
    <div className="stack">
      <PageHeader title={t('security.title')} lead={t('security.lead')} />
      <Card
        title={t('security.vault')}
        id="vault"
        actions={
          state.vault ? (
            <span className={`pill ${unlocked ? 'pill--success' : 'pill--muted'}`}>
              {unlocked ? <LockOpen size={11} /> : <Lock size={11} />}{' '}
              {unlocked ? t('vault.unlockedShort') : t('vault.lockedShort')}
            </span>
          ) : null
        }
      >
        {state.vault ? <VaultOn /> : <VaultOff />}
      </Card>

      <Card title={t('security.privacy')} id="privacy">
        <div className="privacy">
          <ShieldCheck aria-hidden="true" />
          <p>{t('security.privacyBody')}</p>
        </div>
      </Card>

      <Card title={t('security.danger')} id="danger">
        <div className="danger-row">
          <div>
            <strong>{t('security.wipe')}</strong>
            <p className="field__hint">{t('security.wipeHint')}</p>
          </div>
          <button
            type="button"
            className="btn btn--danger-soft"
            disabled={pending === 'data.wipe'}
            onClick={async () => {
              if (
                await confirm({
                  title: t('security.wipe'),
                  body: t('security.wipeConfirm'),
                  confirmLabel: t('common.delete'),
                  danger: true,
                })
              ) {
                if (await run('data.wipe', {})) notify(t('security.wiped'));
              }
            }}
          >
            <Trash2 /> {t('security.wipe')}
          </button>
        </div>
      </Card>
    </div>
  );
}

function VaultOff() {
  const { t } = useI18n();
  const { run, pending } = useManager();
  const notify = useToast();
  const [passphrase, setPassphrase] = useState('');
  const [repeat, setRepeat] = useState('');
  const mismatch = repeat.length > 0 && passphrase !== repeat;
  const ready = passphrase.length >= 8 && passphrase === repeat;
  return (
    <form
      className="form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!ready) return;
        if (await run('vault.create', { passphrase })) {
          notify(t('security.enabled'));
          setPassphrase('');
          setRepeat('');
        }
      }}
    >
      <Callout tone="warning" icon={<ShieldAlert aria-hidden="true" />}>
        {t('security.vaultOff')}
      </Callout>
      <div className="form__grid">
        <Field label={t('security.passphrase')} hint={t('security.passphraseHint')} htmlFor="vault-new">
          <input
            id="vault-new"
            className="input"
            type="password"
            autoComplete="new-password"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
          />
          <StrengthMeter value={passphrase} />
        </Field>
        <Field
          label={t('security.passphraseConfirm')}
          error={mismatch ? t('security.mismatch') : null}
          htmlFor="vault-repeat"
        >
          <input
            id="vault-repeat"
            className="input"
            type="password"
            autoComplete="new-password"
            value={repeat}
            aria-invalid={mismatch}
            onChange={(event) => setRepeat(event.target.value)}
          />
        </Field>
      </div>
      <div className="form__actions form__actions--start">
        <button type="submit" className="btn btn--primary" disabled={!ready || pending === 'vault.create'}>
          {pending === 'vault.create' ? <Spinner /> : <KeyRound />} {t('security.enable')}
        </button>
      </div>
    </form>
  );
}

function VaultOn() {
  const { t } = useI18n();
  const { data, run, pending } = useManager();
  const notify = useToast();
  const confirm = useConfirm();
  const [unlockValue, setUnlockValue] = useState('');
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [disableValue, setDisableValue] = useState('');
  const [panel, setPanel] = useState<'none' | 'change' | 'disable'>('none');
  const { unlocked, state } = data;

  return (
    <div className="form">
      <Callout tone="success" icon={<ShieldCheck aria-hidden="true" />}>
        {t('security.vaultOn')}
      </Callout>

      {unlocked ? (
        <div className="row">
          <button type="button" className="btn" onClick={() => void run('vault.lock', {})}>
            <Lock /> {t('vault.lockNow')}
          </button>
        </div>
      ) : (
        <form
          className="row"
          onSubmit={async (event) => {
            event.preventDefault();
            const result = await chrome.runtime.sendMessage({ type: 'vault.unlock', passphrase: unlockValue });
            if (result?.ok) {
              setUnlockValue('');
              setUnlockError(null);
            } else {
              setUnlockError(t('vault.wrong'));
            }
          }}
        >
          <Field label={t('vault.passphrase')} error={unlockError} htmlFor="vault-unlock">
            <div className="row">
              <input
                id="vault-unlock"
                className="input"
                type="password"
                autoComplete="current-password"
                value={unlockValue}
                aria-invalid={Boolean(unlockError)}
                onChange={(event) => {
                  setUnlockValue(event.target.value);
                  setUnlockError(null);
                }}
              />
              <button type="submit" className="btn btn--primary" disabled={!unlockValue}>
                <LockOpen /> {t('common.unlock')}
              </button>
            </div>
          </Field>
        </form>
      )}

      <Field label={t('security.autoLock')} htmlFor="vault-autolock">
        <select
          id="vault-autolock"
          className="select"
          style={{ maxWidth: 320 }}
          value={state.settings.autoLockMinutes}
          onChange={(event) => void run('settings.update', { patch: { autoLockMinutes: Number(event.target.value) } })}
        >
          {AUTO_LOCK_CHOICES.map((minutes) => (
            <option key={minutes} value={minutes}>
              {minutes === 0
                ? t('security.autoLockNever')
                : minutes >= 60
                  ? t('security.autoLockHours', { n: minutes / 60 })
                  : t('security.autoLockMinutes', { n: minutes })}
            </option>
          ))}
        </select>
      </Field>

      <div className="row">
        <button
          type="button"
          className="btn"
          aria-expanded={panel === 'change'}
          onClick={() => setPanel(panel === 'change' ? 'none' : 'change')}
        >
          <KeyRound /> {t('security.change')}
        </button>
        <button
          type="button"
          className="btn"
          aria-expanded={panel === 'disable'}
          onClick={() => setPanel(panel === 'disable' ? 'none' : 'disable')}
        >
          <LockOpen /> {t('security.disable')}
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={async () => {
            if (
              await confirm({
                title: t('security.forgot'),
                body: t('security.forgotConfirm'),
                confirmLabel: t('security.reset'),
                danger: true,
              })
            ) {
              await run('vault.reset', {});
            }
          }}
        >
          {t('security.forgot')}
        </button>
      </div>

      {panel === 'change' && (
        <form
          className="subpanel"
          onSubmit={async (event) => {
            event.preventDefault();
            if (await run('vault.change', { current, next })) {
              notify(t('security.changed'));
              setCurrent('');
              setNext('');
              setPanel('none');
            }
          }}
        >
          <div className="form__grid">
            <Field label={t('security.current')} htmlFor="vault-current">
              <input
                id="vault-current"
                className="input"
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(event) => setCurrent(event.target.value)}
              />
            </Field>
            <Field label={t('security.new')} hint={t('security.passphraseHint')} htmlFor="vault-next">
              <input
                id="vault-next"
                className="input"
                type="password"
                autoComplete="new-password"
                value={next}
                onChange={(event) => setNext(event.target.value)}
              />
              <StrengthMeter value={next} />
            </Field>
          </div>
          <div className="form__actions form__actions--start">
            <button
              type="submit"
              className="btn btn--primary"
              disabled={!current || next.length < 8 || pending === 'vault.change'}
            >
              {t('common.save')}
            </button>
          </div>
        </form>
      )}

      {panel === 'disable' && (
        <form
          className="subpanel"
          onSubmit={async (event) => {
            event.preventDefault();
            if (await run('vault.disable', { passphrase: disableValue })) {
              notify(t('security.disabled'));
              setDisableValue('');
              setPanel('none');
            }
          }}
        >
          <Field label={t('security.disableConfirm')} htmlFor="vault-disable">
            <div className="row">
              <input
                id="vault-disable"
                className="input"
                type="password"
                autoComplete="current-password"
                value={disableValue}
                onChange={(event) => setDisableValue(event.target.value)}
              />
              <button type="submit" className="btn btn--danger" disabled={!disableValue || pending === 'vault.disable'}>
                {t('security.disable')}
              </button>
            </div>
          </Field>
        </form>
      )}
    </div>
  );
}
