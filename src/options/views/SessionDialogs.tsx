import { Download, FileUp, Upload } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import type { AppDef } from '../../core/types';
import { MAX_IMPORT_LENGTH } from '../../core/session-import';
import { send } from '../../shared/protocol';
import { Callout, Dialog, Field, Spinner, useToast } from '../../ui/controls';
import { downloadText } from '../../ui/download';
import { errorText } from '../../ui/hooks';
import { useI18n } from '../../ui/i18n';
import { useManager } from '../context';

/** "Nguyễn Văn A" → "nguyen-van-a", for file names. */
function slug(text: string): string {
  return (
    text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'swapdeck'
  );
}

/**
 * Sends one account (or a workspace) to someone: a password-locked file with only that, which they
 * add with Backup → Import ("add to what I have"; it can never replace their data). No server.
 * Errors show in the dialog: a toast would sit under the modal's backdrop.
 */
export function ShareDialog({
  open,
  onClose,
  scope,
  name,
}: {
  open: boolean;
  onClose: () => void;
  scope: { accountId: string } | { workspaceId: string };
  name: string;
}) {
  const { t } = useI18n();
  const notify = useToast();
  const { requireUnlock } = useManager();
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  // The length is checked once the first field is left (or on submit), not on every key.
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();
  const workspace = 'workspaceId' in scope;
  const short = checked && password.length < 8;
  const mismatch = again.length > 0 && again !== password;
  const ready = password.length >= 8 && again === password;
  const close = () => {
    setPassword('');
    setAgain('');
    setChecked(false);
    setError(null);
    onClose();
  };
  return (
    <Dialog open={open} onClose={close} title={t('share.title')}>
      <form
        className="form"
        onSubmit={async (event) => {
          event.preventDefault();
          setChecked(true);
          if (!ready || busy) return;
          // The file carries sign-ins: a locked passphrase is asked for first.
          if (!(await requireUnlock())) return;
          setBusy(true);
          setError(null);
          const result = await send('backup.export', { password, includeSessions: true, only: scope });
          setBusy(false);
          if (!result.ok) {
            setError(errorText(t, result));
            return;
          }
          downloadText(result.data.text, `swapdeck-share-${slug(name)}.json`);
          notify(
            result.data.unreadable.length
              ? t('backup.downloadedUnreadable', { names: result.data.unreadable.join(', ') })
              : t('share.done'),
            result.data.unreadable.length ? 'error' : 'success',
          );
          close();
        }}
      >
        <p className="share-target">{name}</p>
        <p className="dialog__text">{t(workspace ? 'share.leadWorkspace' : 'share.lead')}</p>
        <Callout tone="warning">{t(workspace ? 'share.warningWorkspace' : 'share.warning')}</Callout>
        <Field
          label={t('backup.password')}
          htmlFor={`${id}-pw`}
          hint={t('share.passwordHint')}
          error={short ? t('share.passwordShort') : undefined}
        >
          <input
            id={`${id}-pw`}
            className="input"
            type="password"
            autoComplete="new-password"
            data-autofocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onBlur={() => setChecked(password.length > 0)}
            aria-invalid={short || undefined}
          />
        </Field>
        <Field
          label={t('backup.passwordConfirm')}
          htmlFor={`${id}-again`}
          error={mismatch ? t('backup.passwordMismatch') : undefined}
        >
          <input
            id={`${id}-again`}
            className="input"
            type="password"
            autoComplete="new-password"
            value={again}
            onChange={(event) => setAgain(event.target.value)}
            aria-invalid={mismatch || undefined}
          />
        </Field>
        {error && <Callout tone="danger">{error}</Callout>}
        <div className="form__actions">
          <button type="button" className="btn" onClick={close}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn--primary" disabled={!ready || busy}>
            {busy ? <Spinner /> : <Download />} {t('share.download')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * Saves a sign-in exported by another tool as an account: Cookie-Editor / EditThisCookie JSON,
 * Playwright storage state, Netscape cookies.txt or a Cookie header — pasted or from a file.
 * Errors (a format it doesn't know, no cookie of the app) show in the dialog, next to the text.
 */
export function ImportSessionDialog({ open, onClose, app }: { open: boolean; onClose: () => void; app: AppDef }) {
  const { t } = useI18n();
  const notify = useToast();
  const { data } = useManager();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const close = () => {
    setText('');
    setError(null);
    onClose();
  };
  return (
    <Dialog open={open} onClose={close} title={t('importSession.title', { app: app.name })} wide>
      <form
        className="form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setError(null);
          const result = await send('session.import', { appId: app.id, text });
          setBusy(false);
          if (!result.ok) {
            setError(errorText(t, result));
            return;
          }
          const { accountId, created, skipped } = result.data;
          const label = data.state.accounts.find((account) => account.id === accountId)?.label ?? '';
          notify(
            [
              created ? t('importSession.created', { label }) : t('importSession.updated', { label }),
              skipped ? t('importSession.skipped', { n: skipped }) : '',
            ]
              .filter(Boolean)
              .join(' '),
          );
          close();
        }}
      >
        <p className="dialog__text">{t('importSession.lead')}</p>
        <Field label={t('importSession.paste')} htmlFor={`${id}-text`} hint={t('importSession.formats')}>
          <textarea
            id={`${id}-text`}
            className="textarea textarea--mono"
            rows={8}
            spellCheck={false}
            data-autofocus
            value={text}
            maxLength={MAX_IMPORT_LENGTH}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={(event) => {
              setText(event.target.value);
              setError(null);
            }}
          />
        </Field>
        <div className="row">
          <button type="button" className="btn btn--sm" onClick={() => fileRef.current?.click()}>
            <FileUp /> {t('importSession.file')}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,.txt,application/json,text/plain"
            hidden
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              if (file.size > MAX_IMPORT_LENGTH) {
                setError(t('importSession.tooLarge'));
                return;
              }
              setText(await file.text());
              setError(null);
            }}
          />
        </div>
        {error ? (
          <div id={`${id}-error`}>
            <Callout tone="danger">{error}</Callout>
          </div>
        ) : (
          <Callout tone="info">{t('importSession.privacy')}</Callout>
        )}
        <div className="form__actions">
          <button type="button" className="btn" onClick={close}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn--primary" disabled={!text.trim() || busy}>
            {busy ? <Spinner /> : <Upload />} {t('importSession.button')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
