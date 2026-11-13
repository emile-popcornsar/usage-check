export function displayLabel(raw: string): string {
  if (raw === 'Current week (all models)') return '이번 주 (전체 모델)';
  if (raw === 'Current session') return '현재 세션';
  const week = /^Current week \((.+)\)$/.exec(raw);
  return week ? `이번 주 (${week[1]})` : raw;
}
