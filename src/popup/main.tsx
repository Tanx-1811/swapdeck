import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { resolveLanguage } from '../i18n/translate';
import { ConfirmProvider, ToastProvider } from '../ui/controls';
import { useSwapdeck, useTheme } from '../ui/hooks';
import { I18nProvider } from '../ui/i18n';
import '../styles/fonts';
import '../styles/ui.css';
import './popup.css';
import { AskWindow } from './AskWindow';
import { Switcher } from './Switcher';

/** popup.html?ask=<id>: the confirmation window for a switch started outside the popup. */
const ASK = new URLSearchParams(location.search).get('ask');

function Root() {
  const data = useSwapdeck();
  useTheme(data?.state.settings.theme, data?.state.settings.accent);
  return (
    <I18nProvider language={resolveLanguage(data?.state.settings.language ?? 'auto')}>
      <ToastProvider>
        <ConfirmProvider>
          {ASK ? <AskWindow id={ASK} loaded={Boolean(data)} /> : <Switcher data={data} mode="popup" />}
        </ConfirmProvider>
      </ToastProvider>
    </I18nProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
