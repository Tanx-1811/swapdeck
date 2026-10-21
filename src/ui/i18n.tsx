import { createContext, use, useEffect, useMemo, type ReactNode } from 'react';
import { createTranslator, type Language, type Translate } from '../i18n/translate';

type I18nValue = { language: Language; t: Translate };

const I18nContext = createContext<I18nValue>({ language: 'en', t: createTranslator('en') });

export function I18nProvider({ language, children }: { language: Language; children: ReactNode }) {
  const value = useMemo(() => ({ language, t: createTranslator(language) }), [language]);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  return <I18nContext value={value}>{children}</I18nContext>;
}

export function useI18n(): I18nValue {
  return use(I18nContext);
}
