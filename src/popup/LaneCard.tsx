import { AppWindow, Plus, Save, Users, X } from 'lucide-react';
import { identityLabel } from '../core/identity';
import type { LaneSummary } from '../core/lane-registry';
import type { AppDef } from '../core/types';
import { Callout, Spinner, useToast } from '../ui/controls';
import { useI18n } from '../ui/i18n';
import { useSwitcher } from './context';

/**
 * The current tab is a separate tab: who is signed in here, that the app's other tabs keep their
 * account, and what can be done with it (save a scratch sign-in, open another tab of it, hand the
 * account to every tab, close it).
 */
export function LaneCard({ app, lane }: { app: AppDef; lane: LaneSummary }) {
  const { t } = useI18n();
  const notify = useToast();
  const { data, run, pending, busy, switchAccount, openLane, close, refresh } = useSwitcher();
  const { state } = data;
  const account = lane.accountId ? state.accounts.find((item) => item.id === lane.accountId) : undefined;
  const active = state.accounts.find((item) => item.id === state.active[app.id]);
  const who = identityLabel(lane.identity) || t('lane.nobody');
  const scratch = lane.kind === 'scratch';
  const canSave = scratch || lane.status === 'other-person';

  return (
    <>
      <Callout
        tone="brand"
        icon={<AppWindow aria-hidden="true" />}
        title={scratch ? t('lane.scratch') : `${t('lane.thisTab')} · ${account?.label ?? lane.title}`}
        actions={
          <>
            {canSave && (
              <button
                type="button"
                className="btn btn--primary btn--sm"
                disabled={pending !== null}
                onClick={async () => {
                  const saved = await run('lane.save', { token: lane.token }, 'lane.save');
                  if (!saved) return;
                  const latest = await chrome.storage.local.get('sd:accounts');
                  const list = (latest['sd:accounts'] as { id: string; label: string }[] | undefined) ?? [];
                  notify(t('lane.saved', { label: list.find((item) => item.id === saved.accountId)?.label ?? '' }));
                  refresh();
                }}
              >
                {pending === 'lane.save' ? <Spinner /> : <Save />} {t('lane.save')}
              </button>
            )}
            {account && !scratch && (
              <>
                <button
                  type="button"
                  className="btn btn--sm"
                  title={t('lane.toMainHint')}
                  disabled={busy !== null}
                  onClick={() => void switchAccount(app, account)}
                >
                  <Users /> {t('lane.toMain')}
                </button>
                <button
                  type="button"
                  className="btn btn--sm"
                  disabled={busy !== null}
                  onClick={() => void openLane(app, account)}
                >
                  <Plus /> {t('lane.anotherTab')}
                </button>
              </>
            )}
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              title={scratch ? undefined : t('lane.closeHint')}
              disabled={pending !== null}
              onClick={async () => {
                if (await run('lane.close', { token: lane.token }, 'lane.close')) close();
              }}
            >
              {pending === 'lane.close' ? <Spinner /> : <X />} {t('lane.close')}
            </button>
          </>
        }
      >
        <p>{t('lane.thisTabBody', { who, app: app.name, active: active?.label ?? t('lane.noneActive') })}</p>
        {scratch && <p>{t('lane.thisTabScratch')}</p>}
      </Callout>
      {lane.status === 'other-person' && account && (
        <Callout tone="warning" title={t('lane.statusOther')}>
          {t('lane.toastOtherPerson', { label: account.label })}
        </Callout>
      )}
      {lane.status === 'signed-out' && !scratch && <Callout tone="info" title={t('lane.statusSignedOut')} />}
      {lane.workerWarning && <Callout tone="warning">{t('lane.workerWarning')}</Callout>}
    </>
  );
}
