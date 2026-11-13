import { it, expect } from 'vitest';
import { clampZoom, nextZoom, zoomStepForKey } from '../../src/core/zoom';

const key = (k: string, code: string, extra: Partial<{ type: string; control: boolean; alt: boolean; meta: boolean }> = {}) =>
  ({ type: 'keyDown', key: k, code, control: true, alt: false, meta: false, ...extra });

it('zooms in and out by half a level and back to 0', () => {
  expect(nextZoom(0, 'in')).toBe(0.5);
  expect(nextZoom(0.5, 'in')).toBe(1);
  expect(nextZoom(0, 'out')).toBe(-0.5);
  expect(nextZoom(-2.5, 'out')).toBe(-3);
  expect(nextZoom(2.5, 'reset')).toBe(0);
});
it('stays within -3 to +3', () => {
  expect(nextZoom(3, 'in')).toBe(3);
  expect(nextZoom(-3, 'out')).toBe(-3);
  expect(nextZoom(2.8, 'in')).toBe(3);
});
it('turns a stored value into a usable level', () => {
  expect(clampZoom(1.5)).toBe(1.5);
  expect(clampZoom(9)).toBe(3);
  expect(clampZoom(-9)).toBe(-3);
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, '2', null, undefined, {}]) expect(clampZoom(bad)).toBe(0);
});
it('reads Ctrl with +, =, -, 0 and the numpad keys', () => {
  expect(zoomStepForKey(key('+', 'Equal'))).toBe('in'); // Ctrl+Shift+=
  expect(zoomStepForKey(key('=', 'Equal'))).toBe('in');
  expect(zoomStepForKey(key('+', 'NumpadAdd'))).toBe('in');
  expect(zoomStepForKey(key('-', 'Minus'))).toBe('out');
  expect(zoomStepForKey(key('-', 'NumpadSubtract'))).toBe('out');
  expect(zoomStepForKey(key('0', 'Digit0'))).toBe('reset');
  expect(zoomStepForKey(key('0', 'Numpad0'))).toBe('reset'); // NumLock on
});
it('leaves Ctrl+Insert (numpad 0 with NumLock off) to copy', () => {
  expect(zoomStepForKey(key('Insert', 'Numpad0'))).toBeNull();
});
it('ignores other keys, key release, and Alt or Meta combinations', () => {
  expect(zoomStepForKey(key('=', 'Equal', { control: false }))).toBeNull();
  expect(zoomStepForKey(key('=', 'Equal', { type: 'keyUp' }))).toBeNull();
  expect(zoomStepForKey(key('=', 'Equal', { alt: true }))).toBeNull();
  expect(zoomStepForKey(key('=', 'Equal', { meta: true }))).toBeNull();
  expect(zoomStepForKey(key('r', 'KeyR'))).toBeNull();
  expect(zoomStepForKey(key('1', 'Digit1'))).toBeNull();
});
