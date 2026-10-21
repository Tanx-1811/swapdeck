import { useCallback } from 'react';
import { askText, type AskInput, type UnsavedTab } from '../core/ask';
import { send } from '../shared/protocol';
import { useConfirm } from './controls';
import { useI18n } from './i18n';

/**
 * Asks before a switch when it moves to an important account, would reload tabs
 * holding unsaved work, or the "ask before every switch" setting is on.
 * Resolves true when the switch may go ahead.
 */
export function useAskBeforeSwitch() {
  const { t } = useI18n();
  const confirm = useConfirm();
  return useCallback(
    async (input: Omit<AskInput, 'unsaved'> & { appIds: string[] }): Promise<boolean> => {
      let unsaved: UnsavedTab[] = [];
      if (input.appIds.length) {
        const result = await send('unsaved', { appIds: input.appIds });
        if (result.ok) unsaved = result.data;
      }
      const text = askText(t, { ...input, unsaved });
      if (!text) return true;
      return confirm({
        title: text.title,
        body: text.body,
        items: text.items,
        confirmLabel: text.confirm,
        danger: text.danger,
      });
    },
    [t, confirm],
  );
}
