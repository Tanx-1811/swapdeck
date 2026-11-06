import type { AppDef } from '../core/types';
import type { Translate } from '../i18n/translate';
import type { WorkspaceOutcome } from '../shared/protocol';
import { errorText } from './hooks';

export type OutcomeMessage = { text: string; tone: 'success' | 'info' | 'error' };

/**
 * What a workspace switch did, for a toast: how many apps switched, then each app
 * that didn't, one per line. Nothing switched at all is an error, never "switched".
 */
export function workspaceOutcomeMessage(
  t: Translate,
  name: string,
  outcome: Pick<WorkspaceOutcome, 'switched' | 'failed' | 'results'>,
  apps: readonly AppDef[],
): OutcomeMessage {
  const { switched, failed, results } = outcome;
  if (switched === 0 && failed === 0) return { text: t('workspaces.alreadyInUse', { name }), tone: 'success' };
  const problems = results
    .filter((result) => result.status !== 'switched' && result.status !== 'already')
    .map((result) => {
      const app = apps.find((item) => item.id === result.appId)?.name ?? result.appId;
      const reason =
        result.status === 'no-access'
          ? t('workspaces.reasonAccess')
          : result.status === 'no-session'
            ? t('workspaces.reasonSession')
            : errorText(t, { error: result.error ?? 'UNKNOWN' });
      // Reasons are sentences of their own; one line per app reads better without their full stop.
      return `${app}: ${reason.replace(/[.。]\s*$/, '')}`;
    });
  if (switched === 0) {
    return { text: [t('workspaces.noneSwitched', { name }), ...problems].join('\n'), tone: 'error' };
  }
  const head = t('workspaces.switched', { name, n: switched });
  if (!failed) return { text: head, tone: 'success' };
  return { text: [head, t('workspaces.someFailed'), ...problems].join('\n'), tone: 'info' };
}
