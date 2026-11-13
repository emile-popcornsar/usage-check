import { it, expect } from 'vitest';
import { isSupportedClaudeVersion } from '../../src/core/claudeVersion';

it('accepts Claude Code 2.1.318 and later', () => {
  expect(['2.1.318', '2.1.319', '2.2.0', '3.0.0', null].map(isSupportedClaudeVersion)).toEqual([true, true, true, true, true]);
  expect(['2.1.317', '2.0.999', '1.9.9'].map(isSupportedClaudeVersion)).toEqual([false, false, false]);
});
