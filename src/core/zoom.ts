export type ZoomStep = 'in' | 'out' | 'reset';

const ZOOM_STEP = 0.5;
const ZOOM_MIN = -3;
const ZOOM_MAX = 3;

// A stored or computed zoom level as one the window may use: a number from -3 to +3, otherwise 0.
export function clampZoom(level: unknown): number {
  if (typeof level !== 'number' || !Number.isFinite(level)) return 0;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, level));
}

export function nextZoom(current: number, step: ZoomStep): number {
  if (step === 'reset') return 0;
  return clampZoom(current + (step === 'in' ? ZOOM_STEP : -ZOOM_STEP));
}

// The fields of Electron's before-input-event input that the zoom keys depend on.
export type KeyInput = { type: string; key: string; code: string; control: boolean; alt: boolean; meta: boolean };

// Ctrl with + (also = and numpad +), - (also numpad -) or 0; any other key gives null.
// Matched on the key, not its position: numpad + and - give '+' and '-' whatever NumLock is, and numpad 0 with
// NumLock off is Insert, so Ctrl+Insert stays Copy.
export function zoomStepForKey(input: KeyInput): ZoomStep | null {
  if (input.type !== 'keyDown' || !input.control || input.alt || input.meta) return null;
  if (input.key === '+' || input.key === '=') return 'in';
  if (input.key === '-') return 'out';
  if (input.key === '0') return 'reset';
  return null;
}
