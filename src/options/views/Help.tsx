import { ArrowLeftRight, Bug, Code, Cookie, Database, Save } from 'lucide-react';
import { useI18n } from '../../ui/i18n';
import { Card, PageHeader } from '../Options';

const REPO = 'https://github.com/Tanx-1811/swapdeck';

export function Help() {
  const { t } = useI18n();
  const questions = [1, 2, 3, 4, 5, 6, 7] as const;
  return (
    <div className="stack">
      <PageHeader title={t('help.title')} />
      <Card title={t('help.how')} id="how">
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
          <li>
            <span>{t('overview.tipPopup')}</span>
            <span>
              <kbd>Alt</kbd> <kbd>Shift</kbd> <kbd>A</kbd>
            </span>
          </li>
          <li>
            <span>{t('overview.tipNext')}</span>
            <span>
              <kbd>Alt</kbd> <kbd>Shift</kbd> <kbd>S</kbd>
            </span>
          </li>
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
      <p className="muted small center">
        <Database size={12} aria-hidden="true" /> {t('help.version', { version: chrome.runtime.getManifest().version })}
      </p>
    </div>
  );
}
