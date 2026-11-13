// tests/guard.test.ts
import { it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : [p];
});
const src = files('src').map((p) => ({ p, text: readFileSync(p, 'utf8') }));
const offenders = (re: RegExp) => src.filter((f) => re.test(f.text)).map((f) => f.p);

it('never touches the login files', () => {
  expect(offenders(/\.credentials|keychain|keytar|safeStorage/i)).toEqual([]);
});
it('makes no network request of its own', () => {
  expect(offenders(/\bfetch\(|XMLHttpRequest|WebSocket|from 'node:https?'|from 'https?'|require\('https?'\)|net\.request|https?:\/\/|electron-updater/)).toEqual([]);
});
it('runs only the agreed Claude Code commands', () => {
  const cmds = readFileSync('src/main/claudeCommands.ts', 'utf8');
  expect(cmds).toContain("'-p', '/usage', '--safe-mode', '--no-session-persistence', '--output-format', 'json'");
  expect(offenders(/setup-token|--dangerously|--bare/)).toEqual([]);
});
it('ships a content security policy', () => {
  expect(readFileSync('src/renderer/index.html', 'utf8')).toContain("default-src 'self'");
});
