import { Plus, Trash2, Wand2, X } from 'lucide-react';
import { useState } from 'react';
import { parseHttpUrl } from '../../core/domains';
import type { Workspace } from '../../core/types';
import { ACCOUNT_COLORS, newId } from '../../core/util';
import { pruneMembers } from '../../core/workspaces';
import { AppIcon } from '../../ui/Avatar';
import { ColorPicker } from '../../ui/ColorPicker';
import { Field, useConfirm, useToast } from '../../ui/controls';
import { IconPicker } from '../../ui/IconPicker';
import { useI18n } from '../../ui/i18n';
import { WorkspaceBadge } from '../../popup/WorkspaceBar';
import { useManager } from '../context';
import { Card } from '../Options';
import { navigate } from '../router';

type LinkDraft = { id: string; title: string; url: string };

export function WorkspaceEditor({ id }: { id: string | null }) {
  const { t } = useI18n();
  const { data, run, pending } = useManager();
  const notify = useToast();
  const confirm = useConfirm();
  const { state } = data;
  const existing = id ? state.workspaces.find((workspace) => workspace.id === id) : undefined;
  const [name, setName] = useState(existing?.name ?? '');
  const [icon, setIcon] = useState(existing?.icon ?? '');
  const [color, setColor] = useState(
    existing?.color ?? ACCOUNT_COLORS[state.workspaces.length % ACCOUNT_COLORS.length]!,
  );
  const [note, setNote] = useState(existing?.note ?? '');
  const [members, setMembers] = useState<Record<string, string>>(() =>
    existing ? pruneMembers(existing.members, state.accounts) : {},
  );
  const [links, setLinks] = useState<LinkDraft[]>(() =>
    (existing?.links ?? []).map((link) => ({ id: link.id, title: link.title, url: link.url })),
  );

  if (id && !existing) {
    return (
      <div className="empty-card">
        <p>{t('error.NOT_FOUND')}</p>
        <a className="btn" href="#/workspaces">
          {t('common.back')}
        </a>
      </div>
    );
  }

  const appsWithAccounts = state.apps.filter((app) => state.accounts.some((account) => account.appId === app.id));
  const linkErrors = links.map((link) =>
    link.url.trim() && !parseHttpUrl(link.url.trim()) ? t('form.invalidUrl') : null,
  );
  const invalid = !name.trim() || linkErrors.some(Boolean);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (invalid) return;
    const workspace: Pick<Workspace, 'name' | 'color' | 'members' | 'links'> &
      Partial<Pick<Workspace, 'emoji' | 'note'>> = {
      name: name.trim(),
      color,
      members,
      links: links
        .filter((link) => link.url.trim())
        .map((link) => ({ id: link.id, url: link.url.trim(), title: link.title.trim() || link.url.trim() })),
      ...(icon ? { icon } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    const saved = await run('workspace.save', { ...(existing ? { id: existing.id } : {}), workspace });
    if (saved) {
      notify(t('common.saved'));
      navigate('#/workspaces');
    }
  };

  return (
    <div className="stack">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <a href="#/workspaces">{t('workspaces.title')}</a>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{existing ? existing.name : t('workspaces.new')}</span>
      </nav>
      <header className="app-header">
        <WorkspaceBadge
          workspace={{ name: name || '?', color, icon: icon || undefined, emoji: icon ? undefined : existing?.emoji }}
          size={44}
        />
        <div className="app-header__text">
          <h1>{existing ? t('workspaces.editTitle') : t('workspaces.new')}</h1>
          <p className="muted">{t('workspaces.editLead')}</p>
        </div>
      </header>
      <form className="stack" onSubmit={submit}>
        <Card>
          <div className="form">
            <div className="form__grid">
              <Field label={t('workspaces.name')} htmlFor="ws-name">
                <input
                  id="ws-name"
                  className="input"
                  value={name}
                  maxLength={80}
                  required
                  autoFocus={!existing}
                  placeholder={t('workspaces.namePlaceholder')}
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
              <Field label={t('account.note')} htmlFor="ws-note">
                <input
                  id="ws-note"
                  className="input"
                  value={note}
                  maxLength={300}
                  placeholder={t('workspaces.notePlaceholder')}
                  onChange={(event) => setNote(event.target.value)}
                />
              </Field>
            </div>
            <div className="form__grid">
              <IconPicker value={icon} onChange={setIcon} />
              <ColorPicker
                label={t('account.color')}
                value={color}
                onChange={setColor}
                keep={existing?.color}
                limit={10}
              />
            </div>
          </div>
        </Card>

        <Card
          title={t('workspaces.members')}
          lead={t('workspaces.membersLead')}
          id="ws-members"
          actions={
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => {
                const next: Record<string, string> = {};
                for (const app of appsWithAccounts) {
                  const accountId = state.active[app.id];
                  if (accountId) next[app.id] = accountId;
                }
                setMembers(next);
              }}
            >
              <Wand2 /> {t('workspaces.useActive')}
            </button>
          }
        >
          {appsWithAccounts.length === 0 ? (
            <p className="muted">{t('workspaces.noApps')}</p>
          ) : (
            <div className="member-table" role="table" aria-label={t('workspaces.members')}>
              {appsWithAccounts.map((app) => {
                const accounts = state.accounts.filter((account) => account.appId === app.id);
                return (
                  <div key={app.id} className="member-row" role="row">
                    <span className="member-row__app" role="cell">
                      <AppIcon app={app} size="sm" />
                      <label htmlFor={`member-${app.id}`}>{app.name}</label>
                    </span>
                    <span role="cell">
                      <select
                        id={`member-${app.id}`}
                        className="select"
                        value={members[app.id] ?? ''}
                        onChange={(event) =>
                          setMembers((current) => {
                            const next = { ...current };
                            if (event.target.value) next[app.id] = event.target.value;
                            else delete next[app.id];
                            return next;
                          })
                        }
                      >
                        <option value="">{t('workspaces.leaveAsIs')}</option>
                        {accounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.label}
                            {account.email && account.email !== account.label ? ` — ${account.email}` : ''}
                          </option>
                        ))}
                      </select>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card
          title={t('workspaces.links')}
          lead={t('workspaces.linksLead')}
          id="ws-links"
          actions={
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => setLinks((current) => [...current, { id: newId('pin'), title: '', url: '' }])}
            >
              <Plus /> {t('workspaces.addLink')}
            </button>
          }
        >
          {links.length === 0 ? (
            <p className="muted">{t('workspaces.noLinks')}</p>
          ) : (
            <div className="link-rows">
              {links.map((link, index) => (
                <div key={link.id} className="link-row">
                  <input
                    className="input"
                    value={link.title}
                    aria-label={t('workspaces.linkTitle')}
                    placeholder={t('workspaces.linkTitle')}
                    onChange={(event) =>
                      setLinks((current) =>
                        current.map((item) => (item.id === link.id ? { ...item, title: event.target.value } : item)),
                      )
                    }
                  />
                  <input
                    className="input"
                    type="url"
                    value={link.url}
                    aria-label={t('workspaces.linkUrl')}
                    aria-invalid={Boolean(linkErrors[index])}
                    placeholder="https://"
                    onChange={(event) =>
                      setLinks((current) =>
                        current.map((item) => (item.id === link.id ? { ...item, url: event.target.value } : item)),
                      )
                    }
                  />
                  <button
                    type="button"
                    className="btn btn--ghost btn--icon btn--sm"
                    aria-label={`${t('common.remove')}: ${link.title || link.url}`}
                    onClick={() => setLinks((current) => current.filter((item) => item.id !== link.id))}
                  >
                    <X />
                  </button>
                  {linkErrors[index] && (
                    <p className="field__error link-row__error" role="alert">
                      {linkErrors[index]}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="form__actions">
          {existing && (
            <button
              type="button"
              className="btn btn--danger-soft"
              onClick={async () => {
                if (
                  await confirm({
                    title: t('workspaces.delete'),
                    body: t('workspaces.deleteConfirm', { name: existing.name }),
                    confirmLabel: t('common.delete'),
                    danger: true,
                  })
                ) {
                  if (await run('workspace.remove', { id: existing.id })) navigate('#/workspaces');
                }
              }}
            >
              <Trash2 /> {t('workspaces.delete')}
            </button>
          )}
          <span className="form__spacer" />
          <a className="btn" href="#/workspaces">
            {t('common.cancel')}
          </a>
          <button type="submit" className="btn btn--primary" disabled={invalid || pending === 'workspace.save'}>
            {t('common.save')}
          </button>
        </div>
      </form>
    </div>
  );
}
