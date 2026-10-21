import type { LanguagePreference } from '../core/types';
import { en, type MessageKey } from './en';
import { vi } from './vi';

export type { MessageKey };
export type Language = 'en' | 'vi';
export type MessageParams = Record<string, string | number>;
export type Translate = (key: MessageKey, params?: MessageParams) => string;

export const LANGUAGES: Language[] = ['en', 'vi'];

const DICTIONARIES: Record<Language, Record<MessageKey, string>> = { en, vi };

function browserLanguage(): string {
  try {
    return chrome.i18n.getUILanguage();
  } catch {
    return typeof navigator === 'undefined' ? 'en' : navigator.language;
  }
}

export function resolveLanguage(preference: LanguagePreference, uiLanguage = browserLanguage()): Language {
  if (preference !== 'auto') return preference;
  return uiLanguage.toLowerCase().startsWith('vi') ? 'vi' : 'en';
}

/** Replaces {placeholders}; unknown placeholders are left as they are. */
export function formatMessage(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

export function createTranslator(language: Language): Translate {
  const dictionary = DICTIONARIES[language];
  return (key, params) => formatMessage(dictionary[key] ?? en[key], params);
}

export function isMessageKey(key: string): key is MessageKey {
  return Object.prototype.hasOwnProperty.call(en, key);
}

export function dictionaryFor(language: Language): Record<MessageKey, string> {
  return DICTIONARIES[language];
}

/** "2 minutes ago" / "2 phút trước", using the platform's relative time formatting. */
export function relativeTime(timestamp: number, language: Language, now = Date.now()): string {
  const seconds = Math.round((timestamp - now) / 1000);
  const abs = Math.abs(seconds);
  const format = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
  if (abs < 45) return format.format(0, 'second');
  if (abs < 45 * 60) return format.format(Math.round(seconds / 60), 'minute');
  if (abs < 22 * 3600) return format.format(Math.round(seconds / 3600), 'hour');
  if (abs < 26 * 86400) return format.format(Math.round(seconds / 86400), 'day');
  if (abs < 320 * 86400) return format.format(Math.round(seconds / (30 * 86400)), 'month');
  return format.format(Math.round(seconds / (365 * 86400)), 'year');
}

export function formatBytes(bytes: number, language: Language): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = value < 10 && unit > 0 ? 1 : 0;
  return `${new Intl.NumberFormat(language, { maximumFractionDigits: digits }).format(value)} ${units[unit]}`;
}

export function formatDateTime(timestamp: number, language: Language): string {
  return new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp);
}
