import { spawn, type ChildProcess, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { posix, win32 } from 'node:path';

export type RunResult = { code: number | null; stdout: string; stderr: string; timedOut: boolean; aborted: boolean };
export type ClaudeRunner = {
  run(args: readonly string[], opts: { configDir: string | null; timeoutMs: number; signal?: AbortSignal }): Promise<RunResult>;
  dispose(): void;
};

// Variables that would make Claude Code use some other login than the account folder.
export const STRIPPED_ENV: readonly string[] = [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_OAUTH_REFRESH_TOKEN',
  'ANTHROPIC_PROFILE', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY',
];

// cmd expands these before it reads quotes, so they cannot be passed safely through a shell.
const SHELL_UNSAFE = ['"', '%', '!', String.fromCharCode(13), String.fromCharCode(10)];

const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;

// End the child and everything it started (a .cmd runs through a shell, so the shell has children).
function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    killer.on('error', () => child.kill());
  } else {
    child.kill('SIGKILL');
  }
}

export function createRunner(claudePath: string, workDir: string, baseEnv: NodeJS.ProcessEnv): ClaudeRunner {
  const running = new Set<ChildProcess>();
  const viaShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(claudePath);

  function run(args: readonly string[], opts: { configDir: string | null; timeoutMs: number; signal?: AbortSignal }): Promise<RunResult> {
    const env: NodeJS.ProcessEnv = { ...baseEnv };
    if (opts.configDir !== null) {
      const remove = new Set([...STRIPPED_ENV, 'CLAUDE_CONFIG_DIR']);
      for (const key of Object.keys(env)) {
        if (remove.has(process.platform === 'win32' ? key.toUpperCase() : key)) delete env[key];
      }
      env.CLAUDE_CONFIG_DIR = opts.configDir;
    }
    const failure = (message: string): RunResult => ({ code: null, stdout: '', stderr: message, timedOut: false, aborted: false });
    if (viaShell && args.some((a) => SHELL_UNSAFE.some((c) => a.includes(c)))) {
      return Promise.resolve(failure('argument contains a character the Windows shell cannot pass safely (% ! " or a line break)'));
    }
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let aborted = false;
      let settled = false;
      const common = { cwd: workDir, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'] };
      let child: ChildProcessByStdio<null, Readable, Readable>;
      try {
        child = viaShell
          ? spawn([claudePath, ...args].map(quote).join(' '), [], { ...common, shell: true })
          : spawn(claudePath, [...args], common);
      } catch (e) {
        resolve(failure(e instanceof Error ? e.message : String(e)));
        return;
      }
      running.add(child);

      const finish = (code: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
        running.delete(child);
        resolve({ code, stdout, stderr, timedOut, aborted });
      };
      const timer = setTimeout(() => { timedOut = true; killTree(child); }, opts.timeoutMs);
      const onAbort = () => { aborted = true; killTree(child); };
      if (opts.signal?.aborted) onAbort();
      else opts.signal?.addEventListener('abort', onAbort, { once: true });

      child.stdout.setEncoding('utf8').on('data', (d: string) => { stdout += d; });
      child.stderr.setEncoding('utf8').on('data', (d: string) => { stderr += d; });
      child.on('error', (e) => { stderr += e.message; finish(null); });
      child.on('close', (code) => finish(code));
    });
  }

  return { run, dispose: () => { for (const child of running) killTree(child); } };
}

// A saved path that exists but does not answer --version is treated as not found, so the no-claude screen can replace it.
// A path found on PATH or in a known place is used as before, even if its version could not be read.
export function claudeUsable(found: string | null, savedPath: string | null, version: string | null): boolean {
  return found !== null && !(found === savedPath && version === null);
}

export function findClaude(o: {
  override: string | null; exclusive: boolean; env: NodeJS.ProcessEnv; platform: NodeJS.Platform; homeDir: string; exists: (p: string) => boolean;
}): string | null {
  if (o.override !== null && o.exists(o.override)) return o.override;
  if (o.exclusive) return null;
  const win = o.platform === 'win32';
  const path = win ? win32 : posix;
  const names = win ? ['claude.exe', 'claude.cmd'] : ['claude'];
  const pathVar = o.env.PATH ?? o.env.Path ?? '';
  for (const dir of pathVar.split(win ? ';' : ':').filter(Boolean)) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (o.exists(candidate)) return candidate;
    }
  }
  const known = win
    ? [path.join(o.homeDir, '.local', 'bin', 'claude.exe'), ...(o.env.APPDATA ? [path.join(o.env.APPDATA, 'npm', 'claude.cmd')] : [])]
    : [path.join(o.homeDir, '.local', 'bin', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude', path.join(o.homeDir, '.npm-global', 'bin', 'claude')];
  return known.find((p) => o.exists(p)) ?? null;
}
