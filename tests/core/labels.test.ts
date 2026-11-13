import { it, expect } from 'vitest';
import { displayLabel } from '../../src/core/labels';

it('translates known labels and keeps unknown ones', () => {
  expect(displayLabel('Current week (all models)')).toBe('이번 주 (전체 모델)');
  expect(displayLabel('Current week (Fable)')).toBe('이번 주 (Fable)');
  expect(displayLabel('Current session')).toBe('현재 세션');
  expect(displayLabel('Something new')).toBe('Something new');
});
