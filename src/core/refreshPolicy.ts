export const COOLDOWN_MS = 60_000;
export const AUTO_REFRESH_MS = 300_000;
export const FOCUS_STALE_MS = 300_000;
export const INFO_NOTICE_MS = 10_000;

export function isCoolingDown(lastStart: number | null, now: number): boolean {
  return lastStart !== null && now - lastStart < COOLDOWN_MS;
}

export function focusNeedsRefresh(lastStart: number | null, now: number): boolean {
  return lastStart === null || now - lastStart > FOCUS_STALE_MS;
}

// Whether a tick of the periodic timer reads usage now.
export function periodicReadDue(o: { autoRefresh: boolean; autoRefreshPaused: boolean; visible: boolean; minimized: boolean }): boolean {
  return o.autoRefresh && !o.autoRefreshPaused && o.visible && !o.minimized;
}
