import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { claudeUsable, createRunner, findClaude, STRIPPED_ENV } from '../../src/main/claudeCli';

const fake = resolve('tests/fixtures/fake-claude.cmd');
const tmp = () => mkdtempSync(join(tmpdir(), 'usage check 실행 '));       // 공백과 한글이 든 경로

describe('createRunner', () => {
  it('runs in the work dir with the account folder, without other Anthropic credentials', async () => {
    const work = tmp(); const profile = join(tmp(), '계정 폴더'); mkdirSync(profile);
    const r = createRunner(fake, work, { ...process.env, ANTHROPIC_API_KEY: 'sk-should-not-pass' });
    const out = await r.run(['echo-env', '--email', 'a@b.com'], { configDir: profile, timeoutMs: 20_000 });
    const seen = JSON.parse(out.stdout.trim().split('\n').pop()!);
    expect(out.code).toBe(0);
    expect(seen.CLAUDE_CONFIG_DIR).toBe(profile);
    expect(seen.ANTHROPIC_API_KEY).toBeUndefined();
    expect(resolve(seen.cwd)).toBe(resolve(work));
    expect(seen.args).toEqual(['echo-env', '--email', 'a@b.com']);
  });
  it('leaves the environment alone for the default login', async () => {
    const r = createRunner(fake, tmp(), { ...process.env, ANTHROPIC_API_KEY: 'sk-kept', CLAUDE_CONFIG_DIR: undefined });
    const seen = JSON.parse((await r.run(['echo-env'], { configDir: null, timeoutMs: 20_000 })).stdout.trim().split('\n').pop()!);
    expect(seen.ANTHROPIC_API_KEY).toBe('sk-kept');
    expect(seen.CLAUDE_CONFIG_DIR).toBeUndefined();
  });
  it('strips the listed variables', () => {
    expect(STRIPPED_ENV).toEqual(['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_OAUTH_REFRESH_TOKEN',
      'ANTHROPIC_PROFILE', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY']);
  });
  it('stops a run on timeout, on abort and on dispose', async () => {
    const r = createRunner(fake, tmp(), process.env);
    const timed = await r.run(['sleep'], { configDir: null, timeoutMs: 1_000 });
    expect(timed.timedOut).toBe(true);
    const ac = new AbortController();
    const p = r.run(['sleep'], { configDir: null, timeoutMs: 30_000, signal: ac.signal });
    setTimeout(() => ac.abort(), 500);
    expect((await p).aborted).toBe(true);
    const q = r.run(['sleep'], { configDir: null, timeoutMs: 30_000 });
    setTimeout(() => r.dispose(), 500);
    expect((await q).code).not.toBe(0);
  }, 20_000);
});

describe('findClaude', () => {
  const win = (existing: string[], extra: Partial<Parameters<typeof findClaude>[0]> = {}) => findClaude({
    override: null, exclusive: false, platform: 'win32', homeDir: 'C:\\Users\\u',
    env: { PATH: 'C:\\a;C:\\b', APPDATA: 'C:\\Users\\u\\AppData\\Roaming' }, exists: (p) => existing.includes(p), ...extra });
  it('prefers the override, then PATH, then known places', () => {
    expect(win(['C:\\x\\claude.exe', 'C:\\a\\claude.exe'], { override: 'C:\\x\\claude.exe' })).toBe('C:\\x\\claude.exe');
    expect(win(['C:\\b\\claude.cmd', 'C:\\Users\\u\\.local\\bin\\claude.exe'])).toBe('C:\\b\\claude.cmd');
    expect(win(['C:\\Users\\u\\.local\\bin\\claude.exe'])).toBe('C:\\Users\\u\\.local\\bin\\claude.exe');
    expect(win(['C:\\Users\\u\\AppData\\Roaming\\npm\\claude.cmd'])).toBe('C:\\Users\\u\\AppData\\Roaming\\npm\\claude.cmd');
    expect(win([])).toBeNull();
  });
  it('looks nowhere else when the override is exclusive', () => {
    expect(win(['C:\\a\\claude.exe'], { override: 'C:\\missing\\claude.exe', exclusive: true })).toBeNull();
  });
  it('treats a saved path that does not answer --version as not found', () => {
    expect(claudeUsable('C:\\x\\claude.exe', 'C:\\x\\claude.exe', null)).toBe(false);
    expect(claudeUsable('C:\\x\\claude.exe', 'C:\\x\\claude.exe', '2.1.319')).toBe(true);
    expect(claudeUsable('C:\\a\\claude.exe', null, null)).toBe(true); // found on PATH: as before
    expect(claudeUsable('C:\\a\\claude.exe', 'C:\\missing\\claude.exe', null)).toBe(true); // saved path gone, PATH used
    expect(claudeUsable(null, null, null)).toBe(false);
  });
  it('knows the usual places on macOS and Linux', () => {
    const mac = findClaude({ override: null, exclusive: false, platform: 'darwin', homeDir: '/Users/u', env: { PATH: '/usr/bin' },
      exists: (p) => p === '/Users/u/.local/bin/claude' });
    expect(mac).toBe('/Users/u/.local/bin/claude');
  });
});

describe('createRunner argument and environment safety', () => {
  it('refuses shell-special arguments on the .cmd route without spawning', async () => {
    const r = createRunner(fake, tmp(), process.env);
    const out = await r.run(['echo-env', '%CMDCMDLINE:~-1%&echo INJECTED_MARKER'], { configDir: null, timeoutMs: 20_000 });
    expect(out.code).toBeNull();
    expect(out.stdout).not.toContain('INJECTED_MARKER');
    expect(out.stderr).not.toBe('');
  });
  it('resolves with an error result when spawning throws', async () => {
    const r = createRunner(fake, tmp(), process.env);
    const out = await r.run(['echo-env', 'a\u0000b'], { configDir: null, timeoutMs: 20_000 });
    expect(out.code).toBeNull();
    expect(out.stderr).not.toBe('');
  });
  it('strips credential variables whatever the case of their names', async () => {
    const r = createRunner(fake, tmp(), { ...process.env, anthropic_api_key: 'sk-lower' });
    const out = await r.run(['echo-env'], { configDir: tmp(), timeoutMs: 20_000 });
    const seen = JSON.parse(out.stdout.trim().split('\n').pop()!);
    expect(seen.ANTHROPIC_API_KEY).toBeUndefined();
  });
});
