import type { AuthStatus, UsageParse } from '../core/types';
import { parseAuthStatus } from '../core/authStatus';
import { parseUsageOutput } from '../core/usageParser';
import type { ClaudeRunner, RunResult } from './claudeCli';

export const TIMEOUT = { version: 15_000, status: 30_000, usage: 60_000, login: 300_000, logout: 30_000 } as const;
export const USAGE_ARGS = ['-p', '/usage', '--safe-mode', '--no-session-persistence', '--output-format', 'json'] as const;

// Only plain addresses are passed on; --email is a hint, the logged-in account is read from auth status afterwards.
const PLAIN_EMAIL = /^[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+$/;

// Only Claude Code's own line ("2.1.322 (Claude Code)") counts, so npm, node or git are not taken for it.
export async function readVersion(r: ClaudeRunner): Promise<string | null> {
  const out = await r.run(['--version'], { configDir: null, timeoutMs: TIMEOUT.version });
  return /(\d+\.\d+\.\d+) \(Claude Code\)/.exec(out.stdout)?.[1] ?? null;
}

// A logged-out folder exits with code 1 but still prints its JSON, so the exit code is not looked at.
export async function readAuthStatus(r: ClaudeRunner, configDir: string | null): Promise<AuthStatus> {
  const out = await r.run(['auth', 'status'], { configDir, timeoutMs: TIMEOUT.status });
  return parseAuthStatus(out.stdout);
}

// stderr is read only to spot a Claude Code that does not know --safe-mode; `stopped` prevents that retry after shutdown.
export async function readUsage(r: ClaudeRunner, configDir: string, stopped: () => boolean = () => false): Promise<UsageParse> {
  const opts = { configDir, timeoutMs: TIMEOUT.usage };
  let out = await r.run(USAGE_ARGS, opts);
  if (out.code !== 0 && out.stderr.includes("unknown option '--safe-mode'") && !stopped()) {
    out = await r.run(USAGE_ARGS.filter((a) => a !== '--safe-mode'), opts);
  }
  return parseUsageOutput(out.stdout);
}

export function startLogin(r: ClaudeRunner, configDir: string, email: string | null): { done: Promise<RunResult>; cancel(): void } {
  const controller = new AbortController();
  const args = email !== null && PLAIN_EMAIL.test(email) ? ['auth', 'login', '--email', email] : ['auth', 'login'];
  return { done: r.run(args, { configDir, timeoutMs: TIMEOUT.login, signal: controller.signal }), cancel: () => controller.abort() };
}

// The runner never rejects, and a failed logout is not reported: the folder is deleted next either way.
export async function logout(r: ClaudeRunner, configDir: string): Promise<void> {
  await r.run(['auth', 'logout'], { configDir, timeoutMs: TIMEOUT.logout });
}
