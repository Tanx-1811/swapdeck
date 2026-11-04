import { ArrowLeftRight, Bug, Code, Cookie, Download, ListChecks, RefreshCw, Save } from 'lucide-react';
import { useState } from 'react';
import { compareVersions, LATEST_RELEASE_API, parseRelease, type ReleaseInfo } from '../../core/version';
import { Callout, Spinner } from '../../ui/controls';
import { useI18n } from '../../ui/i18n';
import { CommandList } from '../../ui/shortcuts';
import { useManager } from '../context';
import { Card, PageHeader } from '../Options';
import { navigate } from '../router';

const REPO = 'https://github.com/Tanx-1811/swapdeck';

type Check = { state: 'idle' | 'checking' | 'latest' | 'error' } | { state: 'newer'; release: ReleaseInfo };

/** The version in use, and "Check for updates" (only when asked: one request to GitHub's public API). */
function UpdatesCard() {
  const { t } = useI18n();
  const manifest = chrome.runtime.getManifest();
  const version = manifest.version;
  // Installed from the Chrome Web Store, Chrome updates it by itself.
  const fromStore = 'update_url' in manifest;
  const [check, setCheck] = useState<Check>({ state: 'idle' });
  const checkNow = async () => {
    setCheck({ state: 'checking' });
    try {
      const response = await fetch(LATEST_RELEASE_API, {
        headers: { Accept: 'application/vnd.github+json' },
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const release = parseRelease(await response.json());
      if (!release?.extension) throw new Error('No release');
      setCheck(compareVersions(release.extension, version) > 0 ? { state: 'newer', release } : { state: 'latest' });
    } catch {
      setCheck({ state: 'error' });
    }
  };
  return (
    <Card title={t('update.title')} lead={t('help.version', { version })} id="updates">
      {fromStore ? (
        <p className="field__hint">{t('update.fromStore')}</p>
      ) : (
        <>
          <div className="row">
            <button type="button" className="btn" disabled={check.state === 'checking'} onClick={() => void checkNow()}>
              {check.state === 'checking' ? <Spinner /> : <RefreshCw />} {t('update.check')}
            </button>
            <span className="muted small" role="status">
              {check.state === 'latest' && t('update.latest', { version })}
              {check.state === 'error' && t('update.error')}
            </span>
          </div>
          {check.state === 'newer' && (
            <Callout
              tone="info"
              title={t('update.available', { version: check.release.extension! })}
              actions={
                <a className="btn btn--primary btn--sm" href={check.release.url} target="_blank" rel="noreferrer">
                  <Download /> {t('update.download')}
                </a>
              }
            >
              {t('update.howTo')}
            </Callout>
          )}
          <p className="field__hint">{t('update.privacy')}</p>
        </>
      )}
    </Card>
  );
}

export function Help() {
  const { t } = useI18n();
  const { run } = useManager();
  const questions = [1, 2, 3, 4, 5, 6, 7] as const;
  return (
    <div className="stack">
      <PageHeader title={t('help.title')} />
      <Card
        title={t('help.how')}
        id="how"
        actions={
          <button
            type="button"
            className="btn btn--sm"
            onClick={async () => {
              await run('settings.update', { patch: { onboardingHidden: false } });
              navigate('#/');
            }}
          >
            <ListChecks /> {t('start.showAgain')}
          </button>
        }
      >
        <ol className="how">
          <li>
            <span className="how__icon">
              <Cookie aria-hidden="true" />
            </span>
            <p>{t('help.how1')}</p>
          </li>
          <li>
            <span className="how__icon">
              <Save aria-hidden="true" />
            </span>
            <p>{t('help.how2')}</p>
          </li>
          <li>
            <span className="how__icon">
              <ArrowLeftRight aria-hidden="true" />
            </span>
            <p>{t('help.how3')}</p>
          </li>
        </ol>
      </Card>
      <Card title={t('help.faq')} id="faq">
        <div className="faq">
          {questions.map((n) => (
            <details key={n} className="faq__item" open={n === 2}>
              <summary>{t(`help.q${n}`)}</summary>
              <p>{t(`help.a${n}`)}</p>
            </details>
          ))}
        </div>
      </Card>
      <Card title={t('help.shortcuts')} id="help-shortcuts">
        <ul className="shortcuts">
          <CommandList only={['_execute_action', 'switch-next', 'switch-workspace-next', 'open-side-panel']} />
          <li>
            <span>{t('popup.keys')}</span>
            <span>
              <kbd>1</kbd> <kbd>/</kbd> <kbd>↑</kbd> <kbd>↓</kbd>
            </span>
          </li>
          <li>
            <span>{t('overview.tipOmnibox', { keyword: 'swd' })}</span>
            <span>
              <kbd>swd</kbd> <kbd>␣</kbd>
            </span>
          </li>
        </ul>
      </Card>
      <UpdatesCard />
      <Card title={t('help.openSource')} lead={t('help.openSourceLead')} id="open-source">
        <div className="row">
          <a className="btn" href={REPO} target="_blank" rel="noreferrer">
            <Code /> {t('help.sourceCode')}
          </a>
          <a className="btn" href={`${REPO}/issues/new/choose`} target="_blank" rel="noreferrer">
            <Bug /> {t('help.reportIssue')}
          </a>
        </div>
      </Card>
    </div>
  );
}
