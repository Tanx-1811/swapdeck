import { AppWindow, Save, SquareDashed, TriangleAlert, X } from 'lucide-react';
import { identityLabel } from '../../core/identity';
import type { LaneSummary } from '../../core/lane-registry';
import { laneLabel, laneStatusView } from '../../core/lane-view';
import type { AppDef } from '../../core/types';
import { useAskBeforeLaneClose } from '../../ui/askBeforeSwitch';
import { AppIcon, Avatar } from '../../ui/Avatar';
import { Spinner, useToast } from '../../ui/controls';
import { useI18n } from '../../ui/i18n';
import { useManager } from '../context';
import { Card } from '../Options';

/**
 * The separate tabs open now (an account's, or a scratch sign-in nobody saved yet), all of them on
 * the overview or one app's on its page: who is signed in there, how many tabs, and Show / Save as
 * account / Close. Follows `sd:lanes` (session storage) as it changes.
 */
export function SeparateTabsCard({ appId }: { appId?: string }) {
  const { t } = useI18n();
  const { data } = useManager();
  const { apps } = data.state;
  const lanes = data.lanes
    .filter((lane) => (appId ? lane.appId === appId : true))
    .map((lane) => ({ lane, app: apps.find((app) => app.id === lane.appId) }))
    .filter((item): item is { lane: LaneSummary; app: AppDef } => item.app !== undefined)
    .sort((a, b) => apps.indexOf(a.app) - apps.indexOf(b.app));
  if (!lanes.length) return null;
  return (
    <Card title={t('lanes.title')} lead={t('lanes.lead')} id="separate-tabs">
      <ul className="lane-rows">
        {lanes.map(({ lane, app }) => (
          <LaneRow key={lane.token} lane={lane} app={app} showApp={!appId} />
        ))}
      </ul>
    </Card>
  );
}

function LaneRow({ lane, app, showApp }: { lane: LaneSummary; app: AppDef; showApp: boolean }) {
  const { t } = useI18n();
  const notify = useToast();
  const askBeforeClose = useAskBeforeLaneClose();
  const { data, run, pending } = useManager();
  const account = lane.accountId ? data.state.accounts.find((item) => item.id === lane.accountId) : undefined;
  const scratch = lane.kind === 'scratch';
  const name = laneLabel(lane, account?.label, app.name);
  const who = identityLabel(lane.identity);
  const status = laneStatusView(lane);
  const statusText =
    status.kind === 'signed-in'
      ? t('lanes.signedInAs', { who })
      : status.kind === 'other-person'
        ? who
          ? t('lanes.otherPerson', { who })
          : t('lanes.someoneElse')
        : status.kind === 'signed-out'
          ? t('lanes.signedOut')
          : t('lanes.nobody');
  const count = lane.tabIds.length;
  // Saving files a sign-in nobody saved yet: a scratch tab's, or someone else signed in to an account's tab.
  const canSave = (scratch && status.kind === 'signed-in') || status.kind === 'other-person';
  const key = (action: string) => `${action}:${lane.token}`;
  const busy = pending !== null && pending.endsWith(`:${lane.token}`);
  const target = showApp ? `${name} · ${app.name}` : name;

  return (
    <li className="lane-row" data-lane={lane.token}>
      <span className="lane-row__icons">
        {account ? (
          <Avatar account={account} />
        ) : (
          <span className="lane-row__scratch" aria-hidden="true">
            <SquareDashed />
          </span>
        )}
        {showApp && (
          <span className="lane-row__app">
            <AppIcon app={app} size="sm" />
          </span>
        )}
      </span>
      <span className="lane-row__text">
        <span className="lane-row__name">
          <strong className="truncate">{name}</strong>
          <span className="lane-row__where truncate">
            {[showApp ? app.name : null, t(count === 1 ? 'lane.tabs.one' : 'lane.tabs', { n: count })]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
        <span className={`lane-row__status lane-row__status--${status.tone} truncate`}>{statusText}</span>
        {lane.workerWarning && (
          <span className="lane-row__warning">
            <TriangleAlert aria-hidden="true" />
            {t('lane.workerWarning')}
          </span>
        )}
      </span>
      <span className="lane-row__actions">
        {canSave && (
          <button
            type="button"
            className="btn btn--primary btn--sm"
            aria-label={`${t('lane.save')}: ${target}`}
            disabled={busy}
            onClick={async () => {
              const saved = await run('lane.save', { token: lane.token }, key('save'));
              if (!saved) return;
              const latest = await chrome.storage.local.get('sd:accounts');
              const list = (latest['sd:accounts'] as { id: string; label: string }[] | undefined) ?? [];
              notify(t('lane.saved', { label: list.find((item) => item.id === saved.accountId)?.label ?? '' }));
            }}
          >
            {pending === key('save') ? <Spinner /> : <Save />} {t('lane.save')}
          </button>
        )}
        <button
          type="button"
          className="btn btn--sm"
          aria-label={`${t('lanes.show')}: ${target}`}
          disabled={busy || count === 0}
          onClick={() => void run('lane.focus', { token: lane.token }, key('focus'))}
        >
          <AppWindow /> {t('lanes.show')}
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          aria-label={`${t('lanes.close')}: ${target}`}
          title={scratch ? undefined : t('lane.closeHint')}
          disabled={busy}
          onClick={async () => {
            if (!(await askBeforeClose(lane))) return;
            await run('lane.close', { token: lane.token }, key('close'));
          }}
        >
          {pending === key('close') ? <Spinner /> : <X />} {t('lanes.close')}
        </button>
      </span>
    </li>
  );
}
