import { useState } from 'react';
import type { Account } from '../core/types';
import { parseHttpUrl } from '../core/domains';
import type { AccountPatch } from '../shared/protocol';
import { Avatar } from './Avatar';
import { ColorPicker } from './ColorPicker';
import { Dialog, Field, ToggleRow } from './controls';
import { IconPicker } from './IconPicker';
import { useI18n } from './i18n';

/** Edits an account's name, icon, color, note and fixed start page. */
export function AccountEditor({
  account,
  open,
  onClose,
  onSave,
  busy,
}: {
  account: Account;
  open: boolean;
  onClose: () => void;
  onSave: (patch: AccountPatch) => void;
  busy?: boolean;
}) {
  const { t } = useI18n();
  const [label, setLabel] = useState(account.label);
  const [icon, setIcon] = useState(account.icon ?? '');
  const [color, setColor] = useState(account.color);
  const [note, setNote] = useState(account.note ?? '');
  const [homeUrl, setHomeUrl] = useState(account.homeUrl ?? '');
  const [important, setImportant] = useState(Boolean(account.important));
  const homeError = homeUrl.trim() && !parseHttpUrl(homeUrl.trim()) ? t('form.invalidUrl') : null;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!label.trim() || homeError) return;
    const clear: NonNullable<AccountPatch['clear']> = [];
    const patch: AccountPatch = { label: label.trim(), color };
    if (icon) patch.icon = icon;
    else clear.push('icon');
    // A symbol (or initials) replaces the emoji chosen in older versions.
    clear.push('emoji');
    if (note.trim()) patch.note = note.trim();
    else clear.push('note');
    if (homeUrl.trim()) patch.homeUrl = homeUrl.trim();
    else clear.push('homeUrl');
    if (important !== Boolean(account.important)) {
      if (important) patch.important = true;
      else clear.push('important');
    }
    onSave({ ...patch, clear });
  };

  return (
    <Dialog open={open} onClose={onClose} title={t('account.edit')}>
      <form className="editor" onSubmit={submit}>
        <div className="editor__preview">
          <Avatar
            account={{
              label: label || '?',
              color,
              icon: icon || undefined,
              emoji: icon ? undefined : account.emoji,
              avatarUrl: account.avatarUrl,
            }}
            size="lg"
          />
          <div className="truncate">
            <strong className="truncate">{label || '…'}</strong>
            {account.email && <div className="muted truncate">{account.email}</div>}
          </div>
        </div>
        <Field label={t('account.rename')} htmlFor="account-label">
          <input
            id="account-label"
            className="input"
            value={label}
            maxLength={120}
            required
            autoFocus
            onChange={(event) => setLabel(event.target.value)}
          />
        </Field>
        <IconPicker value={icon} onChange={setIcon} />
        <ColorPicker label={t('account.color')} value={color} onChange={setColor} keep={account.color} />
        <Field label={t('account.note')} htmlFor="account-note">
          <textarea
            id="account-note"
            className="textarea"
            value={note}
            maxLength={1000}
            rows={2}
            placeholder={t('account.notePlaceholder')}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
        <Field label={t('account.homeUrl')} hint={t('account.homeUrlHint')} error={homeError} htmlFor="account-home">
          <input
            id="account-home"
            className="input"
            type="url"
            value={homeUrl}
            placeholder="https://"
            aria-invalid={Boolean(homeError)}
            onChange={(event) => setHomeUrl(event.target.value)}
          />
        </Field>
        <div className="editor__important">
          <ToggleRow
            title={t('account.important')}
            hint={t('account.importantHint')}
            checked={important}
            onChange={setImportant}
          />
        </div>
        <div className="dialog__actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy || !label.trim() || Boolean(homeError)}>
            {t('common.save')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
