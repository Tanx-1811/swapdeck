/**
 * What the popup and the manager ask about separate tabs (lanes) before acting on them. Reads the
 * lane record through `lane-state.ts` only; opening, saving and ending lanes stay in `lanes.ts`.
 */
import type { UnsavedTab } from '../core/ask';
import { readState } from '../shared/store';
import { hasAccess } from './engine';
import { unsavedInTabs } from './guarded';
import { laneByToken, lanesReady } from './lane-state';

/**
 * Tabs of a separate tab whose pages may hold work that closing it would lose ("Close separate
 * tab" closes them all). Follows the same setting as the question before a switch.
 */
export async function findLaneUnsaved(token: string): Promise<UnsavedTab[]> {
  await lanesReady();
  const lane = laneByToken(token);
  if (!lane) return [];
  const state = await readState();
  if (!state.settings.guardUnsaved) return [];
  const app = state.apps.find((item) => item.id === lane.appId);
  if (!app || !(await hasAccess(app))) return [];
  const tabs = await Promise.all([...lane.tabIds].map((tabId) => chrome.tabs.get(tabId).catch(() => null)));
  return unsavedInTabs(
    app,
    tabs.filter((tab): tab is chrome.tabs.Tab => tab !== null),
  );
}
