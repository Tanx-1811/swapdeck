import { Download, FileJson, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { parseBackupFile } from '../../core/backup';
import { formatDateTime, relativeTime } from '../../i18n/translate';
import type { BackupSummary } from '../../shared/protocol';
import { Callout, Field, Spinner, useConfirm, useToast } from '../../ui/controls';
import { useI18n } from '../../ui/i18n';
import { backupFileName, downloadText } from '../../ui/download';
import { useManager } from '../context';
import { Card, PageHeader } from '../Options';
import { ReloginCard } from './Relogin';

export function Backup() {
  const { t } = useI18n();
  return (
    <div className="stack">
      <PageHeader title={t('backup.title')} lead={t('backup.lead')} />
      <div className="two-columns">
        <ExportCard />
        <ImportCard />
      </div>
      <ReloginCard />
      <Card title={t('move.title')} id="move">
        <ol className="move-steps">
          <li>{t('move.step1')}</li>
          <li>{t('move.step2')}</li>
          <li>{t('move.step3')}</li>
        </ol>
        <Callout tone="warning">{t('move.sessionsNote')}</Callout>
        <p className="muted small">
          {t('move.macNote')} {t('move.syncNote')}
        </p>
      </Card>
      <Callout tone="info">{t('backup.reminder')}</Callout>
    </div>
  );
}

function ExportCard() {
  const { t, language } = useI18n();
  const { data, run, pending } = useManager();
  const notify = useToast();
  const [includeSessions, setIncludeSessions] = useState(true);
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const locked = Boolean(data.state.vault && !data.unlocked);
  const mismatch = repeat.length > 0 && password !== repeat;
  const tooShort = includeSessions && password.length > 0 && password.length < 8;
  const ready = !includeSessions || (password.length >= 8 && password === repeat && !locked);

  return (
    <Card title={t('backup.export')} lead={t('backup.exportLead')} id="export">
      <p className="muted small">
        {data.state.settings.lastBackupAt
          ? t('backup.lastBackup', { time: relativeTime(data.state.settings.lastBackupAt, language) })
          : t('backup.neverBackedUp')}
      </p>
      <form
        className="form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!ready) return;
          const text = await run('backup.export', {
            password: includeSessions || password ? password : null,
            includeSessions,
          });
          if (!text) return;
          downloadText(text, backupFileName());
          notify(t('backup.downloaded'));
          setPassword('');
          setRepeat('');
        }}
      >
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={includeSessions}
            onChange={(event) => setIncludeSessions(event.target.checked)}
          />
          <span>
            <strong>{t('backup.includeSessions')}</strong>
            <span className="field__hint block">{t('backup.includeSessionsHint')}</span>
          </span>
        </label>
        {includeSessions && locked && <Callout tone="warning">{t('backup.needsUnlock')}</Callout>}
        {includeSessions && (
          <div className="form__grid">
            <Field
              label={t('backup.password')}
              error={tooShort ? t('error.INVALID.passphrase') : null}
              htmlFor="backup-password"
            >
              <input
                id="backup-password"
                className="input"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
            <Field
              label={t('backup.passwordConfirm')}
              error={mismatch ? t('backup.passwordMismatch') : null}
              htmlFor="backup-repeat"
            >
              <input
                id="backup-repeat"
                className="input"
                type="password"
                autoComplete="new-password"
                value={repeat}
                aria-invalid={mismatch}
                onChange={(event) => setRepeat(event.target.value)}
              />
            </Field>
          </div>
        )}
        <div className="form__actions form__actions--start">
          <button type="submit" className="btn btn--primary" disabled={!ready || pending === 'backup.export'}>
            {pending === 'backup.export' ? <Spinner /> : <Download />} {t('backup.download')}
          </button>
        </div>
      </form>
    </Card>
  );
}

function ImportCard() {
  const { t, language } = useI18n();
  const { run, pending } = useManager();
  const notify = useToast();
  const confirm = useConfirm();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; text: string; encrypted: boolean } | null>(null);
  const [password, setPassword] = useState('');
  const [summary, setSummary] = useState<BackupSummary | null>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const load = async (picked: File | undefined) => {
    setSummary(null);
    setError(null);
    setPassword('');
    if (!picked) return;
    const text = await picked.text();
    try {
      const parsed = parseBackupFile(text);
      setFile({ name: picked.name, text, encrypted: parsed.encrypted });
      if (!parsed.encrypted) {
        const result = await run('backup.inspect', { text }, 'inspect');
        if (result) setSummary(result);
      }
    } catch {
      setFile(null);
      setError(t('backup.invalid'));
    }
  };

  return (
    <Card title={t('backup.import')} lead={t('backup.importLead')} id="import">
      <div className="form">
        <div
          className={`dropzone${dragOver ? ' dropzone--over' : ''}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            void load(event.dataTransfer.files[0]);
          }}
        >
          <FileJson aria-hidden="true" />
          {file ? <strong className="truncate">{file.name}</strong> : <span className="muted">{t('backup.drop')}</span>}
          <button type="button" className="btn btn--sm" onClick={() => inputRef.current?.click()}>
            <Upload /> {t('backup.choose')}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(event) => {
              void load(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </div>
        {error && <Callout tone="danger">{error}</Callout>}
        {file?.encrypted && !summary && (
          <form
            className="row"
            onSubmit={async (event) => {
              event.preventDefault();
              const result = await run('backup.inspect', { text: file.text, password }, 'inspect');
              if (result) setSummary(result);
            }}
          >
            <Field label={t('backup.encrypted')} htmlFor="import-password">
              <div className="row">
                <input
                  id="import-password"
                  className="input"
                  type="password"
                  autoComplete="off"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button type="submit" className="btn" disabled={!password || pending === 'inspect'}>
                  {pending === 'inspect' ? <Spinner /> : null} {t('common.unlock')}
                </button>
              </div>
            </Field>
          </form>
        )}
        {summary && file && (
          <>
            <Callout tone="success">
              {t('backup.summary', {
                apps: summary.apps,
                accounts: summary.accounts,
                sessions: summary.sessions,
                workspaces: summary.workspaces,
                date: summary.createdAt ? formatDateTime(summary.createdAt, language) : '—',
              })}
            </Callout>
            <fieldset className="fieldset">
              <legend className="visually-hidden">{t('backup.import')}</legend>
              <label className="checkbox-row">
                <input type="radio" name="mode" checked={mode === 'merge'} onChange={() => setMode('merge')} />
                <span>
                  <strong>{t('backup.merge')}</strong>
                  <span className="field__hint block">{t('backup.mergeHint')}</span>
                </span>
              </label>
              <label className="checkbox-row">
                <input type="radio" name="mode" checked={mode === 'replace'} onChange={() => setMode('replace')} />
                <span>
                  <strong>{t('backup.replace')}</strong>
                  <span className="field__hint block">{t('backup.replaceHint')}</span>
                </span>
              </label>
            </fieldset>
            <div className="form__actions form__actions--start">
              <button
                type="button"
                className={`btn ${mode === 'replace' ? 'btn--danger' : 'btn--primary'}`}
                disabled={pending === 'backup.import'}
                onClick={async () => {
                  if (
                    mode === 'replace' &&
                    !(await confirm({
                      title: t('backup.replace'),
                      body: t('backup.replaceHint'),
                      confirmLabel: t('backup.importButton'),
                      danger: true,
                    }))
                  ) {
                    return;
                  }
                  const result = await run('backup.import', {
                    text: file.text,
                    mode,
                    ...(file.encrypted ? { password } : {}),
                  });
                  if (result) {
                    notify(
                      [
                        t('backup.imported', {
                          apps: result.apps,
                          accounts: result.accounts,
                          sessions: result.sessions,
                          workspaces: result.workspaces,
                        }),
                        result.sessions < result.accounts ? t('backup.importedNext') : '',
                        result.syncOff ? t('sync.offAfterReplace') : '',
                      ]
                        .filter(Boolean)
                        .join(' '),
                    );
                    setFile(null);
                    setSummary(null);
                    setPassword('');
                  }
                }}
              >
                {pending === 'backup.import' ? <Spinner /> : <Upload />} {t('backup.importButton')}
              </button>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
