import { it, expect } from 'vitest';
import { reconcileLogin } from '../../src/core/reconcile';

const acct = (id: string, email: string) => ({ id, email, addedAt: '2026-11-01T00:00:00.000Z',
  lines: [{ label: 'Current week (all models)', percent: 40, resetsText: 'x' }], fetchedAt: '2026-11-05T00:00:00.000Z', credentialExpiresAt: '2026-11-20T00:00:00.000Z' });
const login = (id: string, email: string) => ({ id, email, credentialExpiresAt: new Date(2026, 11, 30, 9, 0).toISOString(), now: '2026-11-06T06:51:00.000Z' });

it('adds an unknown email as a new account', () => {
  const r = reconcileLogin([acct('a', 'x@t.com')], login('n', 'y@t.com'), null);
  expect(r.accounts.map((a) => a.id)).toEqual(['a', 'n']);
  expect(r.accounts[1]).toMatchObject({ email: 'y@t.com', addedAt: '2026-11-06T06:51:00.000Z', lines: [], fetchedAt: null });
  expect(r.replacedIds).toEqual([]);
  expect(r.notice).toEqual({ kind: 'info', text: 'y@t.com 계정을 등록했습니다.' });
});
it('renews a known email, keeping its place and last values', () => {
  const r = reconcileLogin([acct('a', 'x@t.com'), acct('b', 'y@t.com')], login('n', 'x@t.com'), 'x@t.com');
  expect(r.accounts.map((a) => a.id)).toEqual(['n', 'b']);
  expect(r.accounts[0]).toMatchObject({ email: 'x@t.com', addedAt: '2026-11-01T00:00:00.000Z', fetchedAt: '2026-11-05T00:00:00.000Z' });
  expect(r.accounts[0].lines).toHaveLength(1);
  expect(r.replacedIds).toEqual(['a']);
  expect(r.notice).toEqual({ kind: 'info', text: 'x@t.com 로그인을 연장했습니다. 새 만료일은 12월 30일입니다.' });
});
it('warns when the browser was on another account, and never touches the intended one', () => {
  const before = [acct('a', 'x@t.com'), acct('b', 'y@t.com')];
  const r = reconcileLogin(before, login('n', 'y@t.com'), 'x@t.com');
  expect(r.accounts[0]).toEqual(before[0]);
  expect(r.accounts[1].id).toBe('n');
  expect(r.replacedIds).toEqual(['b']);
  expect(r.notice).toEqual({ kind: 'warn', text: '브라우저에 로그인된 계정은 y@t.com입니다. 이 계정의 로그인을 연장했습니다. x@t.com 계정을 연장하려면 브라우저에서 그 계정으로 로그인한 뒤 [다시 로그인]을 다시 눌러 주세요.' });
});
it('warns when another, unregistered account came in', () => {
  const r = reconcileLogin([acct('a', 'x@t.com')], login('n', 'z@t.com'), 'x@t.com');
  expect(r.accounts.map((a) => a.email)).toEqual(['x@t.com', 'z@t.com']);
  expect(r.notice).toEqual({ kind: 'warn', text: '브라우저에 로그인된 계정은 z@t.com입니다. 이 계정을 새로 등록했습니다. x@t.com 계정을 연장하려면 브라우저에서 그 계정으로 로그인한 뒤 [다시 로그인]을 다시 눌러 주세요.' });
});
it('compares emails without regard to case', () => {
  expect(reconcileLogin([acct('a', 'X@T.com')], login('n', 'x@t.com'), null).replacedIds).toEqual(['a']);
});
