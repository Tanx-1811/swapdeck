import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { resolveLanguage } from '../i18n/translate';
import { Switcher } from '../popup/Switcher';
import { ConfirmProvider, ToastProvider } from '../ui/controls';
import { useSwapdeck, useTheme } from '../ui/hooks';
import { I18nProvider } from '../ui/i18n';
import '../styles/fonts';
import '../styles/ui.css';
import '../popup/popup.css';

function Root() {
  const data = useSwapdeck();
  useTheme(data?.state.settings.theme, data?.state.settings.accent);
  return (
    <I18nProvider language={resolveLanguage(data?.state.settings.language ?? 'auto')}>
      <ToastProvider>
        <ConfirmProvider>
          <Switcher data={data} mode="panel" />
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
