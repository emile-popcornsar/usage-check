import { it, expect } from 'vitest';
import { AUTO_REFRESH_MS, INFO_NOTICE_MS, isCoolingDown, focusNeedsRefresh, periodicReadDue } from '../../src/core/refreshPolicy';

it('locks the refresh button for one minute', () => {
  expect(isCoolingDown(null, 1_000_000)).toBe(false);
  expect(isCoolingDown(1_000_000, 1_000_000 + 59_999)).toBe(true);
  expect(isCoolingDown(1_000_000, 1_000_000 + 60_000)).toBe(false);
});
it('refreshes on focus only after five minutes', () => {
  expect(focusNeedsRefresh(null, 1_000_000)).toBe(true);
  expect(focusNeedsRefresh(1_000_000, 1_000_000 + 300_000)).toBe(false);
  expect(focusNeedsRefresh(1_000_000, 1_000_000 + 300_001)).toBe(true);
});
it('reads every five minutes and closes info notices after ten seconds', () => {
  expect(AUTO_REFRESH_MS).toBe(300_000);
  expect(INFO_NOTICE_MS).toBe(10_000);
});
it('the periodic tick reads only when switched on, not paused, and the window is visible and not minimised', () => {
  const on = { autoRefresh: true, autoRefreshPaused: false, visible: true, minimized: false };
  expect(periodicReadDue(on)).toBe(true);
  expect(periodicReadDue({ ...on, autoRefresh: false })).toBe(false);
  expect(periodicReadDue({ ...on, autoRefreshPaused: true })).toBe(false);
  expect(periodicReadDue({ ...on, visible: false })).toBe(false);
  expect(periodicReadDue({ ...on, minimized: true })).toBe(false);
});
