import { describe, it, expect } from 'vitest';
import { parseUsageOutput } from '../../src/core/usageParser';

const json = (o: object) => JSON.stringify(o);
const loggedIn = json({
  is_error: false, num_turns: 0, total_cost_usd: 0, local_command: 'usage',
  credential_expires_at: '2026-12-03T22:17:02.335Z',
  result: [
    'You are currently using your subscription to power your Claude Code usage',
    '',
    'Current week (all models): 18% used · resets Nov 11, 6:59am (Asia/Seoul)',
    'Current week (Fable): 20% used · resets Nov 11, 6:59am (Asia/Seoul)',
    '',
    "What's contributing to your usage?",
    'Last 24h · 4648 requests · 56 sessions',
    '  98%  Give simple subagents a cheaper model',
    '  Top skills: /emile-handoff 2%, /superpowers:subagent-driven-development 1%',
  ].join('\n'),
});
const loggedOut = json({
  is_error: false, num_turns: 0, total_cost_usd: 0, local_command: 'usage',
  result: 'Total cost:            $0.0000\nTotal duration (API):  0s\nTotal duration (wall): 1s\nTotal code changes:    0 lines added, 0 lines removed',
});

describe('parseUsageOutput', () => {
  it('reads the usage lines and ignores the advice lines', () => {
    expect(parseUsageOutput(loggedIn)).toEqual({
      kind: 'ok',
      lines: [
        { label: 'Current week (all models)', percent: 18, resetsText: 'Nov 11, 6:59am (Asia/Seoul)' },
        { label: 'Current week (Fable)', percent: 20, resetsText: 'Nov 11, 6:59am (Asia/Seoul)' },
      ],
      credentialExpiresAt: '2026-12-03T22:17:02.335Z',
      modelCalled: false,
    });
  });
  it('reports no lines for a logged-out folder', () => {
    expect(parseUsageOutput(loggedOut)).toEqual({
      kind: 'no-lines',
      preview: ['Total cost:            $0.0000', 'Total duration (API):  0s', 'Total duration (wall): 1s'],
      credentialExpiresAt: null,
      modelCalled: false,
    });
  });
  it('reads 0% and 100%, and a line without reset text', () => {
    const out = json({ num_turns: 0, total_cost_usd: 0, result: 'A: 0% used · resets x\nB: 100% used · resets y\nCurrent session: 42% used' });
    const r = parseUsageOutput(out);
    expect(r.kind === 'ok' && r.lines).toEqual([
      { label: 'A', percent: 0, resetsText: 'x' },
      { label: 'B', percent: 100, resetsText: 'y' },
      { label: 'Current session', percent: 42, resetsText: null },
    ]);
  });
  it('flags a model call', () => {
    const base = { result: 'A: 1% used · resets x' };
    expect((parseUsageOutput(json({ ...base, num_turns: 1, total_cost_usd: 0 })) as any).modelCalled).toBe(true);
    expect((parseUsageOutput(json({ ...base, num_turns: 0, total_cost_usd: 0.01 })) as any).modelCalled).toBe(true);
  });
  it('finds the JSON when other lines come first', () => {
    expect(parseUsageOutput('Update available: 2.1.320\n' + loggedIn).kind).toBe('ok');
  });
  it('treats non-JSON output as unreadable', () => {
    expect(parseUsageOutput('boom\nsecond line')).toEqual({ kind: 'unreadable', preview: ['boom', 'second line'] });
  });
});
