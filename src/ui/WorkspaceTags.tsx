import type { Account, Workspace } from '../core/types';
import { useI18n } from './i18n';

/** The workspaces (clients, companies, projects) that use this account. */
export function workspacesOf(account: Pick<Account, 'id' | 'appId'>, workspaces: readonly Workspace[]): Workspace[] {
  return workspaces.filter((workspace) => workspace.members[account.appId] === account.id);
}

/**
 * A quiet note of which workspaces an account belongs to: a dot in each
 * workspace's color and the first name ("+2" for more). Nothing when it belongs to none.
 */
export function WorkspaceTags({
  account,
  workspaces,
  max = 1,
}: {
  account: Pick<Account, 'id' | 'appId'>;
  workspaces: readonly Workspace[];
  max?: number;
}) {
  const { t } = useI18n();
  const list = workspacesOf(account, workspaces);
  if (!list.length) return null;
  const names = list.map((workspace) => workspace.name).join(', ');
  return (
    <span className="ws-tags" title={t('account.inWorkspaces', { names })}>
      <span className="visually-hidden">{t('account.inWorkspaces', { names })}</span>
      <span className="ws-tags__dots" aria-hidden="true">
        {list.slice(0, 3).map((workspace) => (
          <span key={workspace.id} className="ws-tags__dot" style={{ background: workspace.color }} />
        ))}
      </span>
      <span className="ws-tags__names truncate" aria-hidden="true">
        {list
          .slice(0, max)
          .map((workspace) => workspace.name)
          .join(', ')}
        {list.length > max && ` +${list.length - max}`}
      </span>
    </span>
  );
}
