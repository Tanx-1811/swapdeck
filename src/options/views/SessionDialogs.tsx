import { FileUp, Send, Upload } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import type { AppDef } from '../../core/types';
import { MAX_IMPORT_LENGTH } from '../../core/session-import';
import { Callout, Dialog, Field, Spinner, useToast } from '../../ui/controls';
import { downloadText } from '../../ui/download';
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
  const { run, pending } = useManager();
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const id = useId();
  const short = password.length > 0 && password.length < 8;
  const mismatch = again.length > 0 && again !== password;
  const ready = password.length >= 8 && again === password;
  const close = () => {
    setPassword('');
    setAgain('');
    onClose();
  };
  return (
    <Dialog open={open} onClose={close} title={t('share.title', { name })}>
      <form
        className="form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!ready) return;
          const result = await run('backup.export', { password, includeSessions: true, only: scope }, 'share');
          if (!result) return;
          downloadText(result.text, `swapdeck-share-${slug(name)}.json`);
          notify(
            result.unreadable.length
              ? t('backup.downloadedUnreadable', { names: result.unreadable.join(', ') })
              : t('share.done'),
            result.unreadable.length ? 'error' : 'success',
          );
          close();
        }}
      >
        <p className="muted">{t('share.lead')}</p>
        <Callout tone="warning">{t('share.warning')}</Callout>
        <Field label={t('share.password')} htmlFor={`${id}-pw`} hint={t('share.passwordHint')}>
          <input
            id={`${id}-pw`}
            className="input"
            type="password"
            autoComplete="new-password"
            data-autofocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={short || undefined}
          />
        </Field>
        <Field
          label={t('share.passwordAgain')}
          htmlFor={`${id}-again`}
          error={mismatch ? t('share.mismatch') : short ? t('error.INVALID.password') : undefined}
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
        <div className="form__actions">
          <button type="button" className="btn" onClick={close}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn--primary" disabled={!ready || pending === 'share'}>
            {pending === 'share' ? <Spinner /> : <Send />} {t('share.download')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * Saves a sign-in exported by another tool as an account: Cookie-Editor / EditThisCookie JSON,
 * Playwright storage state, Netscape cookies.txt or a Cookie header — pasted or from a file.
 */
export function ImportSessionDialog({ open, onClose, app }: { open: boolean; onClose: () => void; app: AppDef }) {
  const { t } = useI18n();
  const notify = useToast();
  const { run, pending, data } = useManager();
  const [text, setText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const close = () => {
    setText('');
    onClose();
  };
  return (
    <Dialog open={open} onClose={close} title={t('importSession.title', { app: app.name })} wide>
      <form
        className="form"
        onSubmit={async (event) => {
          event.preventDefault();
          const result = await run('session.import', { appId: app.id, text }, 'session.import');
          if (!result) return;
          const label = data.state.accounts.find((account) => account.id === result.accountId)?.label;
          notify(
            [
              result.created
                ? t('importSession.created', { label: label ?? '' })
                : t('importSession.updated', { label: label ?? '' }),
              result.skipped ? t('importSession.skipped', { n: result.skipped }) : '',
            ]
              .filter(Boolean)
              .join(' '),
          );
          close();
        }}
      >
        <p className="muted">{t('importSession.lead')}</p>
        <Field label={t('importSession.paste')} htmlFor={`${id}-text`} hint={t('importSession.formats')}>
          <textarea
            id={`${id}-text`}
            className="textarea textarea--mono"
            rows={8}
            spellCheck={false}
            data-autofocus
            value={text}
            maxLength={MAX_IMPORT_LENGTH}
            onChange={(event) => setText(event.target.value)}
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
              if (file && file.size <= MAX_IMPORT_LENGTH) setText(await file.text());
            }}
          />
        </div>
        <Callout tone="info">{t('importSession.privacy')}</Callout>
        <div className="form__actions">
          <button type="button" className="btn" onClick={close}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn--primary" disabled={!text.trim() || pending === 'session.import'}>
            {pending === 'session.import' ? <Spinner /> : <Upload />} {t('importSession.button')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
