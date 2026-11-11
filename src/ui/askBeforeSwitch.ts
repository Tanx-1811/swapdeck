import { useCallback } from 'react';
import { askText, laneCloseText, type AskInput, type UnsavedTab } from '../core/ask';
import { identityLabel } from '../core/identity';
import type { LaneSummary } from '../core/lane-registry';
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

/**
 * Asks before "Close separate tab" when its tabs may hold unsaved work (closing closes them) or
 * it is a scratch sign-in nobody saved. Resolves true when the separate tab may close.
 */
export function useAskBeforeLaneClose() {
  const { t } = useI18n();
  const confirm = useConfirm();
  return useCallback(
    async (lane: Pick<LaneSummary, 'token' | 'kind' | 'identity'>): Promise<boolean> => {
      const result = await send('lane.unsaved', { token: lane.token });
      const text = laneCloseText(t, {
        scratch: lane.kind === 'scratch',
        who: identityLabel(lane.identity) || null,
        unsaved: result.ok ? result.data : [],
      });
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
