import type { LaneSummary } from './lane-registry';

/**
 * How a separate tab is named on its own (the app is shown next to it): its account's label, or
 * for a scratch sign-in its tab group's name ("Scratch 2 · Acme") without the app.
 */
export function laneLabel(lane: Pick<LaneSummary, 'title'>, accountLabel: string | undefined, appName: string) {
  if (accountLabel) return accountLabel;
  const suffix = ` · ${appName}`;
  return lane.title.endsWith(suffix) && lane.title.length > suffix.length
    ? lane.title.slice(0, -suffix.length)
    : lane.title;
}

export type LaneStatusView = {
  tone: 'ok' | 'warning' | 'muted';
  kind: 'signed-in' | 'other-person' | 'signed-out' | 'nobody';
};

/** What a separate tab's status line says: who is signed in there, someone else, or nobody. */
export function laneStatusView(lane: Pick<LaneSummary, 'kind' | 'status' | 'identity'>): LaneStatusView {
  if (lane.status === 'other-person') return { tone: 'warning', kind: 'other-person' };
  if (lane.status === 'signed-out' && lane.kind === 'account') return { tone: 'muted', kind: 'signed-out' };
  if (lane.identity && lane.status !== 'signed-out') return { tone: 'ok', kind: 'signed-in' };
  return { tone: 'muted', kind: 'nobody' };
}
