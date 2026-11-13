import { it, expect } from 'vitest';
import { readVersion } from '../../src/main/claudeCommands';
import type { ClaudeRunner } from '../../src/main/claudeCli';

const printing = (stdout: string): ClaudeRunner => ({
  run: async () => ({ code: 0, stdout, stderr: '', timedOut: false, aborted: false }),
  dispose: () => {},
});

it('reads the version only from Claude Code\'s own --version line', async () => {
  expect(await readVersion(printing('2.1.322 (Claude Code)\n'))).toBe('2.1.322');
  expect(await readVersion(printing('Update available: 2.1.330\n2.1.322 (Claude Code)\n'))).toBe('2.1.322');
});

it('does not take another program\'s version for Claude Code', async () => {
  expect(await readVersion(printing('10.9.2\n'))).toBeNull(); // npm.cmd
  expect(await readVersion(printing('v22.12.0\n'))).toBeNull(); // node.exe
  expect(await readVersion(printing('git version 2.47.0.windows.1\n'))).toBeNull();
  expect(await readVersion(printing(''))).toBeNull();
});
