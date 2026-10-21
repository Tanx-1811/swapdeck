import { matchPatterns } from '../core/domains';
import type { AppDef } from '../core/types';

/** Asks Chrome for access to the app's sites. Must run in a click handler. */
export async function requestAccess(app: Pick<AppDef, 'domains'>): Promise<boolean> {
  try {
    return await chrome.permissions.request({ origins: matchPatterns(app) });
  } catch {
    return false;
  }
}

export async function hasAccess(app: Pick<AppDef, 'domains'>): Promise<boolean> {
  try {
    return await chrome.permissions.contains({ origins: matchPatterns(app) });
  } catch {
    return false;
  }
}

/** Calls back whenever host access changes (granted here, in another page, or in chrome://extensions). */
export function onAccessChange(callback: () => void): () => void {
  chrome.permissions.onAdded.addListener(callback);
  chrome.permissions.onRemoved.addListener(callback);
  return () => {
    chrome.permissions.onAdded.removeListener(callback);
    chrome.permissions.onRemoved.removeListener(callback);
  };
}
