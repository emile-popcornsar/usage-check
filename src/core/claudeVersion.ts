export const MIN_CLAUDE_VERSION = '2.1.318';

const toParts = (v: string): number[] => v.split('.').map((p) => parseInt(p, 10) || 0);

export function isSupportedClaudeVersion(version: string | null): boolean {
  if (version === null) return true;
  const have = toParts(version);
  const min = toParts(MIN_CLAUDE_VERSION);
  for (let i = 0; i < 3; i++) {
    const a = have[i] ?? 0;
    if (a !== min[i]) return a > min[i];
  }
  return true;
}
