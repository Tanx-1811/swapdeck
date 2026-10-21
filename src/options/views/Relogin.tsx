import { LogIn } from 'lucide-react';
import type { Account, AppDef } from '../../core/types';
import { useAskBeforeSwitch } from '../../ui/askBeforeSwitch';
import { AppIcon, Avatar } from '../../ui/Avatar';
import { Spinner, useToast } from '../../ui/controls';
import { useI18n } from '../../ui/i18n';
import { useManager } from '../context';
import { Card } from '../Options';
import { useAccess } from './AppDetail';

/**
 * Accounts that have no saved sign-in on this computer (typically just imported
 * from another one): one "Sign in" each. After signing in, Swapdeck recognises
 * the account and files the session under it, and the row goes away.
 */
export function ReloginCard() {
  const { t } = useI18n();
  const { data } = useManager();
  const { apps, accounts, settings } = data.state;
  const waiting = accounts.filter((account) => !account.capturedAt && apps.some((app) => app.id === account.appId));
  if (!waiting.length) return null;
  return (
    <Card title={t('move.reloginTitle')} lead={t('move.reloginLead', { n: waiting.length })} id="relogin">
      {!settings.autoCapture && <p className="field__hint">{t('move.autoCaptureOff')}</p>}
      <ul className="relogin">
        {waiting.map((account) => (
          <ReloginRow key={account.id} account={account} app={apps.find((app) => app.id === account.appId)!} />
        ))}
      </ul>
    </Card>
  );
}

function ReloginRow({ account, app }: { account: Account; app: AppDef }) {
  const { t } = useI18n();
  const { run, pending } = useManager();
  const notify = useToast();
  const askBeforeSwitch = useAskBeforeSwitch();
  const [granted, allow] = useAccess(app);
  const busy = pending === `fresh:${account.id}`;
  return (
    <li className="relogin__row">
      <AppIcon app={app} size="sm" />
      <Avatar account={account} size="sm" />
      <span className="relogin__text">
        <strong className="truncate">{account.label}</strong>
        <span className="muted truncate">
          {app.name}
          {account.email && account.email !== account.label ? ` · ${account.email}` : ''}
        </span>
      </span>
      {granted === false ? (
        <button type="button" className="btn btn--sm" onClick={() => void allow()}>
          {t('common.allow')}
        </button>
      ) : (
        <button
          type="button"
          className="btn btn--primary btn--sm"
          disabled={busy || granted === null}
          onClick={async () => {
            const go = await askBeforeSwitch({
              kind: 'fresh',
              label: app.name,
              app: app.name,
              important: [],
              confirmAll: false,
              appIds: [app.id],
            });
            if (!go) return;
            const outcome = await run('fresh', { appId: app.id, focus: true }, `fresh:${account.id}`);
            if (outcome) notify(t('move.signInStarted', { label: account.label }), 'info');
          }}
        >
          {busy ? <Spinner /> : <LogIn />} {t('move.signIn')}
          <span className="visually-hidden"> {account.label}</span>
        </button>
      )}
    </li>
  );
}
