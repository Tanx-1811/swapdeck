import { Keyboard, Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ACCENTS } from '../../core/settings';
import type { Settings } from '../../core/types';
import { Field, ToggleRow } from '../../ui/controls';
import { useI18n } from '../../ui/i18n';
import { useManager } from '../context';
import { Card, PageHeader } from '../Options';

export function SettingsView() {
  const { t } = useI18n();
  const { data, run } = useManager();
  const settings = data.state.settings;
  const [commands, setCommands] = useState<chrome.commands.Command[]>([]);
  useEffect(() => {
    void chrome.commands.getAll().then(setCommands);
  }, []);
  const set = (patch: Partial<Settings>) => void run('settings.update', { patch });

  return (
    <div className="stack">
      <PageHeader title={t('settings.title')} />
      <Card>
        <div className="form__grid">
          <Field label={t('settings.language')} htmlFor="setting-language">
            <select
              id="setting-language"
              className="select"
              value={settings.language}
              onChange={(event) => set({ language: event.target.value as Settings['language'] })}
            >
              <option value="auto">{t('settings.languageAuto')}</option>
              <option value="vi">Tiếng Việt</option>
              <option value="en">English</option>
            </select>
          </Field>
          <div className="field">
            <span className="field__label">{t('settings.theme')}</span>
            <div className="segmented" role="group" aria-label={t('settings.theme')}>
              {(
                [
                  ['system', t('settings.themeSystem'), <Monitor key="m" />],
                  ['light', t('settings.themeLight'), <Sun key="s" />],
                  ['dark', t('settings.themeDark'), <Moon key="d" />],
                ] as const
              ).map(([value, label, icon]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={settings.theme === value}
                  onClick={() => set({ theme: value })}
                >
                  {icon} {label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="field">
          <span className="field__label" id="setting-accent">
            {t('settings.accent')}
          </span>
          <div className="accent-picker" role="radiogroup" aria-labelledby="setting-accent">
            {ACCENTS.map((accent) => (
              <button
                key={accent}
                type="button"
                role="radio"
                aria-checked={settings.accent === accent}
                className={`accent-option accent-option--${accent}`}
                onClick={() => set({ accent })}
              >
                <span className="accent-option__seal" aria-hidden="true" />
                {t(`accent.${accent}`)}
              </button>
            ))}
          </div>
          <p className="field__hint">{t('settings.accentHint')}</p>
        </div>
        <Field label={t('settings.afterSwitch')} htmlFor="setting-after">
          <select
            id="setting-after"
            className="select"
            style={{ maxWidth: 420 }}
            value={settings.afterSwitch}
            onChange={(event) => set({ afterSwitch: event.target.value as Settings['afterSwitch'] })}
          >
            <option value="last">{t('settings.afterLast')}</option>
            <option value="same">{t('settings.afterSame')}</option>
            <option value="home">{t('settings.afterHome')}</option>
          </select>
        </Field>
      </Card>

      <Card title={t('settings.layoutTitle')} id="layout">
        <div className="form__grid">
          <Field label={t('settings.popupLayout')} hint={t('settings.popupLayoutHint')} htmlFor="setting-layout">
            <select
              id="setting-layout"
              className="select"
              value={settings.popupLayout}
              onChange={(event) => set({ popupLayout: event.target.value as Settings['popupLayout'] })}
            >
              <option value="auto">{t('settings.layoutAuto')}</option>
              <option value="compact">{t('settings.layoutCompact')}</option>
              <option value="wide">{t('settings.layoutWide')}</option>
            </select>
          </Field>
          <Field label={t('settings.actionOpens')} hint={t('settings.actionOpensHint')} htmlFor="setting-action">
            <select
              id="setting-action"
              className="select"
              value={settings.actionOpens}
              onChange={(event) => set({ actionOpens: event.target.value as Settings['actionOpens'] })}
            >
              <option value="popup">{t('settings.actionPopup')}</option>
              <option value="panel">{t('settings.actionPanel')}</option>
            </select>
          </Field>
        </div>
      </Card>

      <Card title={t('settings.behavior')} id="behavior">
        <ToggleRow
          title={t('settings.autoCapture')}
          hint={t('settings.autoCaptureHint')}
          checked={settings.autoCapture}
          onChange={(autoCapture) => set({ autoCapture })}
        />
        <ToggleRow
          title={t('settings.autoSync')}
          hint={t('settings.autoSyncHint')}
          checked={settings.autoSync}
          onChange={(autoSync) => set({ autoSync })}
        />
        <ToggleRow
          title={t('settings.pageToasts')}
          hint={t('settings.pageToastsHint')}
          checked={settings.pageToasts}
          onChange={(pageToasts) => set({ pageToasts })}
        />
        <ToggleRow
          title={t('settings.guardUnsaved')}
          hint={t('settings.guardUnsavedHint')}
          checked={settings.guardUnsaved}
          onChange={(guardUnsaved) => set({ guardUnsaved })}
        />
        <ToggleRow
          title={t('settings.confirmSwitch')}
          checked={settings.confirmSwitch}
          onChange={(confirmSwitch) => set({ confirmSwitch })}
        />
        <ToggleRow title={t('settings.badge')} checked={settings.badge} onChange={(badge) => set({ badge })} />
      </Card>

      <Card
        title={t('settings.shortcuts')}
        lead={t('settings.shortcutsHint')}
        id="shortcuts"
        actions={
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })}
          >
            <Keyboard /> {t('settings.editShortcuts')}
          </button>
        }
      >
        <ul className="shortcuts">
          {commands.map((command) => (
            <li key={command.name}>
              <span>{command.name === '_execute_action' ? t('overview.tipPopup') : command.description}</span>
              <span>
                {command.shortcut ? (
                  command.shortcut
                    .split(/\+|(?<=⌥|⇧|⌘|⌃)/)
                    .filter(Boolean)
                    .map((key, index) => <kbd key={index}>{key}</kbd>)
                ) : (
                  <span className="muted">{t('settings.notSet')}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title={t('settings.omnibox')} id="omnibox">
        <p className="field__hint">{t('settings.omniboxHint', { keyword: 'swd' })}</p>
      </Card>
    </div>
  );
}
