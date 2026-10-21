import { ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { PendingAsk } from '../core/ask';
import { send } from '../shared/protocol';
import { SESSION_KEYS } from '../shared/store';
import { Spinner } from '../ui/controls';
import { errorText } from '../ui/hooks';
import { useI18n } from '../ui/i18n';
import { LogoMark } from '../ui/Logo';

/**
 * The small window that asks before a switch started by a shortcut, the address
 * bar or a menu, when the current page can't show the question itself.
 */
export function AskWindow({ id }: { id: string }) {
  const { t } = useI18n();
  const [pending, setPending] = useState<PendingAsk | null | undefined>(undefined);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void chrome.storage.session.get(SESSION_KEYS.ask).then((raw) => {
      const ask = raw[SESSION_KEYS.ask] as PendingAsk | undefined;
      setPending(ask?.id === id ? ask : null);
      document.documentElement.dataset.ready = '';
    });
  }, [id]);

  const answer = async (ok: boolean) => {
    setWorking(true);
    const result = await send('ask.answer', { id, ok });
    setWorking(false);
    if (!result.ok) {
      setError(result.detail === 'expired' ? t('ask.expired') : errorText(t, result));
      return;
    }
    window.close();
  };

  return (
    <div className="popup ask-window">
      <header className="popup__header">
        <span className="logo">
          <LogoMark size={22} />
          <span>Swapdeck</span>
        </span>
      </header>
      <main className="popup__body">
        {pending === undefined ? (
          <div className="skeleton" style={{ height: 120 }} />
        ) : pending === null ? (
          <p className="muted">{t('ask.expired')}</p>
        ) : (
          <section className="ask" aria-labelledby="ask-title">
            <p className="ask__eyebrow">
              <ShieldAlert aria-hidden="true" /> {t('ask.windowTitle')}
            </p>
            <h1 className="dialog__title" id="ask-title">
              {pending.text.title}
            </h1>
            <p className="dialog__text">{pending.text.body}</p>
            {pending.text.items.length > 0 && (
              <ul className="dialog__list">
                {pending.text.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
            {error && (
              <p className="field__error" role="alert">
                {error}
              </p>
            )}
            <div className="dialog__actions">
              <button type="button" className="btn" disabled={working} onClick={() => void answer(false)} autoFocus>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className={`btn ${pending.text.danger ? 'btn--danger' : 'btn--primary'}`}
                disabled={working}
                onClick={() => void answer(true)}
              >
                {working && <Spinner />} {pending.text.confirm}
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
