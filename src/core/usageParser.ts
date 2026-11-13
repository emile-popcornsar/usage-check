import type { UsageLine, UsageParse } from './types';
import { findJsonObject } from './jsonLine';

const LINE = /^(.+?):\s*(\d{1,3})% used(?:\s*·\s*resets\s+(.+))?$/;

export function parseUsageOutput(stdout: string): UsageParse {
  const obj = findJsonObject(stdout);
  if (!obj) {
    return { kind: 'unreadable', preview: stdout.split(/\r?\n/).filter((l) => l.trim() !== '').slice(0, 3) };
  }
  const result = typeof obj.result === 'string' ? obj.result : '';
  const resultLines = result.split(/\r?\n/);
  const credentialExpiresAt = typeof obj.credential_expires_at === 'string' ? obj.credential_expires_at : null;
  const modelCalled = Number(obj.num_turns) > 0 || Number(obj.total_cost_usd) > 0;

  const lines: UsageLine[] = [];
  for (const text of resultLines) {
    const m = LINE.exec(text.trim());
    if (m) lines.push({ label: m[1], percent: Number(m[2]), resetsText: m[3] ?? null });
  }
  if (lines.length === 0) {
    return { kind: 'no-lines', preview: resultLines.filter((l) => l.trim() !== '').slice(0, 3), credentialExpiresAt, modelCalled };
  }
  return { kind: 'ok', lines, credentialExpiresAt, modelCalled };
}
