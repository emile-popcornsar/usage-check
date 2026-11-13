import { it, expect } from 'vitest';
import { describeAge, formatDateTime } from '../../src/core/format';

const now = new Date(2026, 10, 6, 15, 46);
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

it('describes how long ago the last read was', () => {
  expect(describeAge(null, now)).toBe('아직 조회하지 않음');
  expect(describeAge(ago(20_000), now)).toBe('방금 조회');
  expect(describeAge(ago(3 * 60_000), now)).toBe('3분 전 조회');
  expect(describeAge(ago(2 * 3_600_000), now)).toBe('2시간 전 조회');
  expect(describeAge(new Date(2026, 10, 2, 14, 10).toISOString(), now)).toBe('11월 2일 14:10 조회');
});
it('formats a local date and time', () => {
  expect(formatDateTime(new Date(2026, 10, 30, 14, 10).toISOString())).toBe('11월 30일 14:10');
});
