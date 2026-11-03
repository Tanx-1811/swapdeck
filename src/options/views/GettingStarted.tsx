import { ArrowRight, ExternalLink, Plus } from 'lucide-react';
import { onboardingSteps, onboardingVisible, type OnboardingStepId } from '../../core/onboarding';
import { useI18n } from '../../ui/i18n';
import { useManager } from '../context';
import { Card } from '../Options';
import { navigate } from '../router';

/**
 * "Get started with Swapdeck": the few things worth doing once, ticked off by
 * themselves as they get done. Hidden once the required ones are done, or with
 * "Hide" (Help brings it back).
 */
export function GettingStarted({
  force,
  hasSupabase,
  onAddSupabase,
}: {
  /** Show it even when done or hidden (first run). */
  force?: boolean;
  hasSupabase: boolean;
  onAddSupabase: () => void;
}) {
  const { t } = useI18n();
  const { data, run } = useManager();
  const { state } = data;
  const steps = onboardingSteps(state);
  if (!force && !onboardingVisible(steps, state.settings.onboardingHidden)) return null;
  const required = steps.filter((step) => !step.optional);
  const done = required.filter((step) => step.done).length;
  const firstApp = state.apps[0];

  const action = (id: OnboardingStepId) => {
    switch (id) {
      case 'app':
        return hasSupabase ? (
          <a className="btn btn--sm" href="#/add">
            <Plus /> {t('overview.addApp')}
          </a>
        ) : (
          <div className="row">
            <button type="button" className="btn btn--primary btn--sm" onClick={onAddSupabase}>
              <Plus /> {t('overview.step1Action')}
            </button>
            <a className="btn btn--ghost btn--sm" href="#/add">
              {t('overview.addApp')} <ArrowRight />
            </a>
          </div>
        );
      case 'accounts':
        return firstApp ? (
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => void chrome.tabs.create({ url: firstApp.homeUrl })}
          >
            <ExternalLink /> {t('start.openApp', { app: firstApp.name })}
          </button>
        ) : null;
      case 'workspace':
        return (
          <a className="btn btn--sm" href="#/workspaces/new">
            {t('start.workspaceAction')} <ArrowRight />
          </a>
        );
      case 'lock':
        return (
          <a className="btn btn--sm" href="#/security">
            {t('start.lockAction')} <ArrowRight />
          </a>
        );
      case 'backup':
        return (
          <a className="btn btn--sm" href="#/backup">
            {t('start.backupAction')} <ArrowRight />
          </a>
        );
      case 'sync':
        return (
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => {
              navigate('#/settings');
              setTimeout(() => document.getElementById('sync')?.scrollIntoView({ block: 'start' }), 60);
            }}
          >
            {t('start.syncAction')} <ArrowRight />
          </button>
        );
    }
  };

  return (
    <Card
      title={t('start.title')}
      lead={t('start.progress', { done, total: required.length })}
      id="get-started"
      actions={
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => void run('settings.update', { patch: { onboardingHidden: true } })}
        >
          {t('start.hide')}
        </button>
      }
    >
      <div
        className="start-progress"
        role="progressbar"
        aria-label={t('start.title')}
        aria-valuemin={0}
        aria-valuemax={required.length}
        aria-valuenow={done}
      >
        <span style={{ width: `${(done / required.length) * 100}%` }} />
      </div>
      <ol className="steps">
        {steps.map((step, index) => (
          <li key={step.id} className={`step${step.done ? ' step--done' : ''}`}>
            <span className="step__number" aria-hidden="true">
              {index + 1}
            </span>
            <div className="step__body">
              <p>
                <strong>{t(`start.${step.id}`)}</strong>
                {step.optional && <span className="muted"> · {t('start.optional')}</span>}
                {step.done && <span className="visually-hidden"> — {t('start.done')}</span>}
              </p>
              {!step.done && <p className="muted small">{t(`start.${step.id}Hint`)}</p>}
              {!step.done && action(step.id)}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
