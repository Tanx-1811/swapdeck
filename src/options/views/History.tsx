import { ArrowRight, CircleAlert, CircleCheck, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { HistoryEntry } from '../../core/types';
import { formatDateTime } from '../../i18n/translate';
import { errorText } from '../../ui/hooks';
import { useConfirm } from '../../ui/controls';
import { useI18n } from '../../ui/i18n';
import { useManager } from '../context';
import { Card, PageHeader } from '../Options';

/** "Supabase · Work → Personal" in one line. */
export function HistoryLine({ entry }: { entry: HistoryEntry }) {
  const { t } = useI18n();
  const from = entry.fromLabel ?? (entry.fromId === null ? t('history.signedOut') : null);
  const to = entry.toLabel ?? (entry.toId === null ? t('history.signedOut') : null);
  const saved = entry.kind === 'save' || entry.kind === 'auto-save';
  return (
    <span className="history-line">
      {entry.ok ? (
        <CircleCheck className="history-line__ok" aria-label={t('history.ok')} />
      ) : (
        <CircleAlert className="history-line__failed" aria-label={t('history.failed')} />
      )}
      <strong>{entry.appName}</strong>
      <span className="muted">{t(`history.kind.${entry.kind}`)}</span>
      {from && !saved && <span className="truncate">{from}</span>}
      {from && to && !saved && <ArrowRight className="history-line__arrow" aria-hidden="true" />}
      {to && <span className="truncate">{to}</span>}
      {entry.via && <span className="pill pill--brand">{entry.via}</span>}
    </span>
  );
}

export function History() {
  const { t, language } = useI18n();
  const { data, run } = useManager();
  const confirm = useConfirm();
  const [filter, setFilter] = useState('');
  const entries = data.state.history.filter((entry) => !filter || entry.appId === filter);

  return (
    <div className="stack">
      <PageHeader
        title={t('history.title')}
        lead={t('history.lead')}
        actions={
          data.state.history.length > 0 && (
            <button
              type="button"
              className="btn btn--danger-soft"
              onClick={async () => {
                if (
                  await confirm({
                    title: t('history.clear'),
                    body: t('history.clearConfirm'),
                    confirmLabel: t('history.clear'),
                    danger: true,
                  })
                ) {
                  await run('history.clear', {});
                }
              }}
            >
              <Trash2 /> {t('history.clear')}
            </button>
          )
        }
      />
      <Card>
        {data.state.apps.length > 1 && (
          <div className="toolbar">
            <select
              className="select"
              style={{ maxWidth: 260 }}
              value={filter}
              aria-label={t('history.app')}
              onChange={(event) => setFilter(event.target.value)}
            >
              <option value="">{t('history.filterAll')}</option>
              {data.state.apps.map((app) => (
                <option key={app.id} value={app.id}>
                  {app.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {entries.length === 0 ? (
          <p className="muted">{t('history.empty')}</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t('history.when')}</th>
                  <th scope="col">{t('history.app')}</th>
                  <th scope="col">{t('history.action')}</th>
                  <th scope="col">{t('history.accounts')}</th>
                  <th scope="col">{t('history.result')}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="nowrap">{formatDateTime(entry.at, language)}</td>
                    <td>{entry.appName}</td>
                    <td>
                      {t(`history.kind.${entry.kind}`)}
                      {entry.via && (
                        <>
                          {' '}
                          <span className="pill pill--brand" title={t('history.via', { name: entry.via })}>
                            {entry.via}
                          </span>
                        </>
                      )}
                    </td>
                    <td>
                      <span className="history-accounts">
                        {entry.kind !== 'save' && entry.kind !== 'auto-save' && (
                          <>
                            <span>{entry.fromLabel ?? (entry.fromId === null ? t('history.signedOut') : '—')}</span>
                            <ArrowRight aria-hidden="true" />
                          </>
                        )}
                        <span>{entry.toLabel ?? (entry.toId === null ? t('history.signedOut') : '—')}</span>
                      </span>
                    </td>
                    <td>
                      {entry.ok ? (
                        <span className="pill pill--success">{t('history.ok')}</span>
                      ) : (
                        <span
                          className="pill pill--warning"
                          title={entry.error ? errorText(t, { error: entry.error as never }) : undefined}
                        >
                          {t('history.failed')}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
