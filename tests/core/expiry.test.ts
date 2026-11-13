import { it, expect } from 'vitest';
import { describeExpiry } from '../../src/core/expiry';

const now = new Date(2026, 10, 6, 15, 46);          // 11월 6일 15:46 (현지)
const after = (d: number, h = 0) => new Date(now.getTime() + d * 86_400_000 + h * 3_600_000).toISOString();

it('describes a far expiry', () => {
  expect(describeExpiry(new Date(2026, 11, 4, 7, 17).toISOString(), now)).toEqual({ text: '로그인 만료 12월 4일 · 27일 남음', state: 'ok' });
});
it('marks three days or less as soon', () => {
  expect(describeExpiry(after(4, 1), now).state).toBe('ok');
  expect(describeExpiry(after(3, 1), now).state).toBe('soon');
  expect(describeExpiry(after(0, 5), now)).toEqual({ text: '로그인 만료 11월 6일 · 1일 미만 남음', state: 'soon' });
});
it('handles expired and unknown', () => {
  expect(describeExpiry(after(-1), now)).toEqual({ text: '로그인이 만료되었습니다', state: 'expired' });
  expect(describeExpiry(null, now)).toEqual({ text: '로그인 만료일 알 수 없음', state: 'unknown' });
});
