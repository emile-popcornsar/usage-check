export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${hh}:${mm}`;
}

export function describeAge(fetchedAt: string | null, now: Date): string {
  if (fetchedAt === null) return '아직 조회하지 않음';
  const ms = now.getTime() - new Date(fetchedAt).getTime();
  if (ms < 60_000) return '방금 조회';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}분 전 조회`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}시간 전 조회`;
  return `${formatDateTime(fetchedAt)} 조회`;
}
