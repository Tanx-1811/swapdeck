import { useEffect, useState } from 'react';
import type { MessageKey } from '../i18n/en';
import { useI18n } from './i18n';

/** Swapdeck's own words for each command (Chrome's `description` follows Chrome's language, not Swapdeck's). */
const COMMAND_LABELS: Record<string, MessageKey> = {
  _execute_action: 'shortcut.open',
  'switch-next': 'shortcut.next',
  'switch-previous': 'shortcut.previous',
  'new-login': 'shortcut.newLogin',
  'switch-workspace-next': 'shortcut.workspaceNext',
  'open-side-panel': 'shortcut.sidePanel',
  'open-manager': 'shortcut.manager',
};

/** The suggested keys from the manifest, shown until Chrome answers (or when it can't). */
const DEFAULT_KEYS: Record<string, string> = {
  _execute_action: 'Alt+Shift+A',
  'switch-next': 'Alt+Shift+S',
};

/** The extension's commands with the keys the user actually set in chrome://extensions/shortcuts. */
export function useCommands(): chrome.commands.Command[] {
  const [commands, setCommands] = useState<chrome.commands.Command[]>(() =>
    Object.keys(COMMAND_LABELS).map((name) => ({ name, shortcut: DEFAULT_KEYS[name] ?? '' })),
  );
  useEffect(() => {
    let live = true;
    chrome.commands
      .getAll()
      .then((all) => {
        if (live && all.length) setCommands(all);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return commands;
}

/** One command's shortcut as keys, e.g. ⌥ ⇧ A on a Mac or Alt Shift A elsewhere. */
export function shortcutKeys(shortcut: string | undefined): string[] {
  if (!shortcut) return [];
  return shortcut.split(/\+|(?<=[⌥⇧⌘⌃])/).filter(Boolean);
}

export function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="keys">
      {keys.map((key, index) => (
        <kbd key={index}>{key}</kbd>
      ))}
    </span>
  );
}

/** The label and keys of every command, in Swapdeck's language; unset ones say so. */
export function CommandList({ only }: { only?: string[] }) {
  const { t } = useI18n();
  const commands = useCommands().filter((command) => !only || only.includes(command.name ?? ''));
  const order = only ?? Object.keys(COMMAND_LABELS);
  commands.sort((a, b) => order.indexOf(a.name ?? '') - order.indexOf(b.name ?? ''));
  return (
    <>
      {commands.map((command) => {
        const label = COMMAND_LABELS[command.name ?? ''];
        const keys = shortcutKeys(command.shortcut);
        return (
          <li key={command.name}>
            <span>{label ? t(label) : command.description}</span>
            {keys.length ? <Keys keys={keys} /> : <span className="muted">{t('settings.notSet')}</span>}
          </li>
        );
      })}
    </>
  );
}
