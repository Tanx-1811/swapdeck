/**
 * The worker's record of separate tabs (lanes, core/lane-registry.ts): in memory for quick,
 * synchronous answers ("is this tab in a lane?"), written through to session storage (`sd:lanes`)
 * so a restarted worker finds it again and pages can show it. Only the worker writes it.
 * Kept free of the switching engine so the engine (and tabs.ts) can ask it without a cycle.
 */
import { emptyRegistry, sanitizeRegistry, type Lane, type LaneRegistry } from '../core/lane-registry';

export const LANES_KEY = 'sd:lanes';

let registry: LaneRegistry = emptyRegistry();
let loading: Promise<void> | null = null;

/** Resolves once the record has been read back from session storage (first call reads it). */
export function lanesReady(): Promise<void> {
  loading ??= chrome.storage.session
    .get(LANES_KEY)
    .then((raw) => {
      registry = sanitizeRegistry(raw[LANES_KEY]);
    })
    .catch(() => undefined);
  return loading;
}

export function laneOfTab(tabId: number | undefined | null): Lane | null {
  if (tabId === undefined || tabId === null) return null;
  const token = registry.tabs[tabId];
  return token ? (registry.lanes[token] ?? null) : null;
}

export function isLaneTab(tabId: number | undefined | null): boolean {
  return laneOfTab(tabId) !== null;
}

export function laneByToken(token: string): Lane | null {
  return registry.lanes[token] ?? null;
}

export function laneOfAccount(accountId: string): Lane | null {
  return Object.values(registry.lanes).find((lane) => lane.accountId === accountId) ?? null;
}

export function allLanes(): Lane[] {
  return Object.values(registry.lanes);
}

export function lanesOfApp(appId: string): Lane[] {
  return allLanes().filter((lane) => lane.appId === appId);
}

export function addLane(lane: Lane): void {
  registry.lanes[lane.token] = lane;
  for (const tabId of lane.tabIds) registry.tabs[tabId] = lane.token;
}

export function dropLane(token: string): Lane | null {
  const lane = registry.lanes[token];
  if (!lane) return null;
  delete registry.lanes[token];
  for (const [tabId, owner] of Object.entries(registry.tabs)) if (owner === token) delete registry.tabs[tabId];
  return lane;
}

export function addTabToLane(lane: Lane, tabId: number): void {
  const previous = laneOfTab(tabId);
  if (previous && previous !== lane) previous.tabIds = previous.tabIds.filter((id) => id !== tabId);
  if (!lane.tabIds.includes(tabId)) lane.tabIds.push(tabId);
  registry.tabs[tabId] = lane.token;
}

export function removeTabFromLane(tabId: number): Lane | null {
  const lane = laneOfTab(tabId);
  delete registry.tabs[tabId];
  if (lane) lane.tabIds = lane.tabIds.filter((id) => id !== tabId);
  return lane;
}

let writing: Promise<void> = Promise.resolve();
let dirty = false;

/** Writes the record to session storage (changes made meanwhile go in the same write). */
export function saveLanes(): Promise<void> {
  dirty = true;
  writing = writing.then(async () => {
    if (!dirty) return;
    dirty = false;
    await chrome.storage.session.set({ [LANES_KEY]: registry }).catch(() => undefined);
  });
  return writing;
}

/** A tab moved off its site for a while, and the page it goes back to. */
export type ReleasedTab = { id: number; url: string };

// The engine asks lanes to give an account back before a switch to it (background/lanes.ts sets this).
let releaser: ((accountId: string) => Promise<ReleasedTab[] | null>) | null = null;

export function setLaneReleaser(release: (accountId: string) => Promise<ReleasedTab[] | null>): void {
  releaser = release;
}

/**
 * Ends the account's lane, if it has one, saving its session into the account first: a switch of
 * the browser's own tabs to that account takes over its separate tabs. They wait on a blank page
 * (returned, with their pages) for the switch to send them back. null: the account had no lane.
 */
export async function releaseAccountLane(accountId: string): Promise<ReleasedTab[] | null> {
  await lanesReady();
  if (!releaser || !laneOfAccount(accountId)) return null;
  return releaser(accountId);
}

/** For tests: forget everything in memory (the next lanesReady() reads session storage again). */
export function resetLaneState(): void {
  registry = emptyRegistry();
  loading = null;
  dirty = false;
  writing = Promise.resolve();
}
