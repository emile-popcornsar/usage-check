export type ExpiryState = 'unknown' | 'ok' | 'soon' | 'expired';

export function describeExpiry(expiresAt: string | null, now: Date): { text: string; state: ExpiryState } {
  if (expiresAt === null) return { text: '로그인 만료일 알 수 없음', state: 'unknown' };
  const expires = new Date(expiresAt);
  const remainingMs = expires.getTime() - now.getTime();
  if (remainingMs <= 0) return { text: '로그인이 만료되었습니다', state: 'expired' };
  const days = Math.floor(remainingMs / 86_400_000);
  const date = `${expires.getMonth() + 1}월 ${expires.getDate()}일`;
  const left = days === 0 ? '1일 미만 남음' : `${days}일 남음`;
  return { text: `로그인 만료 ${date} · ${left}`, state: days <= 3 ? 'soon' : 'ok' };
}
