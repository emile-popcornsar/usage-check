import { afterEach, it, expect, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountsService } from '../../src/main/accountsService';
import { loadStore, saveStore, EMPTY_STORE } from '../../src/main/store';
import type { ClaudeRunner, RunResult } from '../../src/main/claudeCli';
import type { StoredAccount, UsageLine } from '../../src/core/types';

// The same two readings as tests/core/usageParser.test.ts.
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

const tmp = () => mkdtempSync(join(tmpdir(), 'usage check 서비스 '));

type Call = { args: string[]; configDir: string | null };
const ok = (stdout: string): RunResult => ({ code: 0, stdout, stderr: '', timedOut: false, aborted: false });

function fakeRunner(reply: (c: Call, signal?: AbortSignal) => RunResult | Promise<RunResult>) {
  const calls: Call[] = [];
  const runner: ClaudeRunner = {
    run: async (args, opts) => { const c = { args: [...args], configDir: opts.configDir }; calls.push(c); return reply(c, opts.signal); },
    dispose: () => {},
  };
  return { runner, calls };
}
const isUsage = (c: Call) => c.args[0] === '-p';
const isStatus = (c: Call) => c.args[0] === 'auth' && c.args[1] === 'status';
const isLogin = (c: Call) => c.args[0] === 'auth' && c.args[1] === 'login';
const isLogout = (c: Call) => c.args[0] === 'auth' && c.args[1] === 'logout';

// `claude auth status` exits with 1 when logged out but still prints its JSON.
const status = (email: string | null): RunResult =>
  email === null ? { ...ok(json({ loggedIn: false, authMethod: 'none' })), code: 1 } : ok(json({ loggedIn: true, email }));
const usageWith = (percent: number) => json({
  is_error: false, num_turns: 0, total_cost_usd: 0, local_command: 'usage',
  result: `Current week (all models): ${percent}% used · resets Nov 11, 7am (Asia/Seoul)`,
});
const untilAborted = (signal?: AbortSignal) => new Promise<RunResult>((resolve) => {
  signal!.addEventListener('abort', () => resolve({ code: null, stdout: '', stderr: '', timedOut: false, aborted: true }), { once: true });
});

const account = (id: string, email: string, lines: UsageLine[] = []): StoredAccount =>
  ({ id, email, addedAt: 'n', lines, fetchedAt: null, credentialExpiresAt: null });
const previous: UsageLine[] = [{ label: 'Current week (all models)', percent: 50, resetsText: 'Nov 9, 7am (Asia/Seoul)' }];
const folder = (dataDir: string, id: string) => join(dataDir, 'profiles', id);

function seed(dataDir: string, accounts: StoredAccount[]): void {
  saveStore(dataDir, { ...EMPTY_STORE, accounts });
  for (const a of accounts) mkdirSync(folder(dataDir, a.id), { recursive: true });
}
function service(dataDir: string, runner: ClaudeRunner | null, now: () => Date = () => new Date(2026, 10, 6, 16, 0)) {
  return new AccountsService({ dataDir, runner, claudeVersion: '2.1.319', now, newId: () => 'n1', onChange: () => {} });
}

it('refresh stores a good reading', async () => {
  const dataDir = tmp(); let t = new Date(2026, 10, 6, 16, 0);
  saveStore(dataDir, { ...EMPTY_STORE, accounts: [{ id: 'a', email: 'x@t.com', addedAt: 'n', lines: [], fetchedAt: null, credentialExpiresAt: null }] });
  const { runner } = fakeRunner((c) => isUsage(c) ? ok(loggedIn) : ok(JSON.stringify({ loggedIn: true, email: 'x@t.com' })));
  const svc = new AccountsService({ dataDir, runner, claudeVersion: '2.1.319', now: () => t, newId: () => 'n1', onChange: () => {} });
  await svc.refresh('start');
  const a = svc.getState().accounts[0];
  expect(a.status).toBe('ok');
  expect(a.lines).toHaveLength(2);
  expect(a.fetchedAt).toBe(t.toISOString());
  expect(loadStore(dataDir).accounts[0].fetchedAt).toBe(t.toISOString());
});

it('refresh marks a logged-out folder as login-required and keeps the last values', async () => {
  const dataDir = tmp();
  seed(dataDir, [account('a', 'x@t.com', previous)]);
  const { runner } = fakeRunner((c) => isUsage(c) ? ok(loggedOut) : status(null));
  const svc = service(dataDir, runner);
  await svc.refresh('start');
  const a = svc.getState().accounts[0];
  expect(a.status).toBe('login-required');
  expect(a.lines).toEqual(previous);
});

it('refresh keeps last values as stale when the read fails but the login is valid', async () => {
  const dataDir = tmp();
  seed(dataDir, [account('a', 'x@t.com', previous)]);
  const { runner } = fakeRunner((c) => isUsage(c) ? ok('boom\nsecond') : status('x@t.com'));
  const svc = service(dataDir, runner);
  await svc.refresh('start');
  const a = svc.getState().accounts[0];
  expect(a.status).toBe('stale');
  expect(a.failurePreview).toEqual(['boom', 'second']);
  expect(a.lines).toEqual(previous);
});

it('refresh reads the default login for the active mark', async () => {
  const dataDir = tmp();
  seed(dataDir, [account('a', 'x@t.com')]);
  const { runner, calls } = fakeRunner((c) => isUsage(c) ? ok(loggedIn) : status(c.configDir === null ? 'x@t.com' : null));
  const svc = service(dataDir, runner);
  await svc.refresh('start');
  expect(svc.getState().activeEmail).toBe('x@t.com');
  const statusCalls = calls.filter(isStatus);
  expect(statusCalls).toHaveLength(1);
  expect(statusCalls[0].configDir).toBeNull();
});

it('manual refresh is ignored during the cooldown', async () => {
  const dataDir = tmp();
  seed(dataDir, [account('a', 'x@t.com')]);
  const t0 = new Date(2026, 10, 6, 16, 0).getTime(); let t = new Date(t0);
  const { runner, calls } = fakeRunner((c) => isUsage(c) ? ok(loggedIn) : status('x@t.com'));
  const svc = service(dataDir, runner, () => t);
  await svc.refresh('start');
  const first = calls.length;
  t = new Date(t0 + 30_000);
  await svc.refresh('manual');
  expect(calls.length).toBe(first);
  expect(svc.getState().cooldownUntil).toBe(new Date(t0 + 60_000).toISOString());
  t = new Date(t0 + 61_000);
  await svc.refresh('manual');
  expect(calls.length).toBeGreaterThan(first);
});

it('a read that called the model pauses automatic refresh', async () => {
  const dataDir = tmp();
  seed(dataDir, [account('a', 'x@t.com')]);
  const t0 = new Date(2026, 10, 6, 16, 0).getTime(); let t = new Date(t0);
  const modelUsed = json({ ...JSON.parse(loggedIn), num_turns: 1 });
  const { runner, calls } = fakeRunner((c) => isUsage(c) ? ok(modelUsed) : status('x@t.com'));
  const svc = service(dataDir, runner, () => t);
  await svc.refresh('start');
  const s = svc.getState();
  expect(s.autoRefreshPaused).toBe(true);
  expect(s.notice).toBeNull(); // the renderer shows the warning from autoRefreshPaused, so a later notice cannot hide it
  const first = calls.length;
  t = new Date(t0 + 20 * 60_000);
  await svc.refresh('timer');
  await svc.refresh('focus');
  expect(calls.length).toBe(first);
  await svc.refresh('manual');
  expect(calls.length).toBeGreaterThan(first);
});

it('at most three reads run at once', async () => {
  const dataDir = tmp();
  seed(dataDir, ['a', 'b', 'c', 'd', 'e'].map((id) => account(id, `${id}@t.com`)));
  let running = 0; let most = 0;
  const { runner } = fakeRunner(async (c) => {
    if (!isUsage(c)) return status(null);
    running++; most = Math.max(most, running);
    await new Promise((r) => setTimeout(r, 50));
    running--;
    return ok(loggedIn);
  });
  await service(dataDir, runner).refresh('start');
  expect(most).toBeLessThanOrEqual(3);
});

it('usage read falls back when --safe-mode is unknown', async () => {
  const dataDir = tmp();
  seed(dataDir, [account('a', 'x@t.com')]);
  const { runner, calls } = fakeRunner((c) => {
    if (isUsage(c) && c.args.includes('--safe-mode')) return { code: 1, stdout: '', stderr: "error: unknown option '--safe-mode'", timedOut: false, aborted: false };
    return isUsage(c) ? ok(loggedIn) : status('x@t.com');
  });
  const svc = service(dataDir, runner);
  await svc.refresh('start');
  const usage = calls.filter(isUsage);
  expect(usage).toHaveLength(2);
  expect(usage[1].args).not.toContain('--safe-mode');
  expect(usage[1].configDir).toBe(usage[0].configDir);
  expect(svc.getState().accounts[0].status).toBe('ok');
});

it('addAccount registers the account the browser logged in', async () => {
  const dataDir = tmp();
  const { runner, calls } = fakeRunner((c) => {
    if (isLogin(c)) return ok('Login successful.');
    if (isStatus(c)) return status(c.configDir === folder(dataDir, 'n1') ? 'y@t.com' : null);
    return ok(loggedIn);
  });
  const svc = service(dataDir, runner);
  await svc.addAccount();
  const s = svc.getState();
  expect(s.accounts.map((a) => [a.id, a.email])).toEqual([['n1', 'y@t.com']]);
  expect(existsSync(folder(dataDir, 'n1'))).toBe(true);
  expect(s.notice?.text).toBe('y@t.com 계정을 등록했습니다.');
  expect(calls.find(isLogin)!.args).not.toContain('--email');
});

it('relogin swaps in the new folder and removes the old one', async () => {
  const dataDir = tmp();
  seed(dataDir, [account('old', 'x@t.com', previous)]);
  const { runner, calls } = fakeRunner((c) => {
    if (isLogin(c)) return ok('Login successful.');
    if (isStatus(c)) return status(c.configDir === folder(dataDir, 'n1') ? 'x@t.com' : null);
    return ok('boom'); // the read after the login fails, so the lines are the ones carried over
  });
  const svc = service(dataDir, runner);
  await svc.relogin('old');
  const [a] = svc.getState().accounts;
  expect(a.id).toBe('n1');
  expect(existsSync(folder(dataDir, 'old'))).toBe(false);
  expect(calls.some((c) => isLogout(c) && c.configDir === folder(dataDir, 'old'))).toBe(true);
  expect(a.lines).toEqual(previous);
  expect(calls.find(isLogin)!.args).toEqual(['auth', 'login', '--email', 'x@t.com']);
});

it('relogin on another browser account leaves the intended account alone', async () => {
  const dataDir = tmp();
  seed(dataDir, [account('x1', 'x@t.com', previous)]);
  const { runner, calls } = fakeRunner((c) => {
    if (isLogin(c)) return ok('Login successful.');
    if (isStatus(c)) return status(c.configDir === folder(dataDir, 'n1') ? 'z@t.com' : null);
    return ok(loggedIn);
  });
  const svc = service(dataDir, runner);
  await svc.relogin('x1');
  const s = svc.getState();
  expect(s.accounts.map((a) => [a.id, a.email])).toEqual([['x1', 'x@t.com'], ['n1', 'z@t.com']]);
  expect(existsSync(folder(dataDir, 'x1'))).toBe(true);
  expect(calls.some(isLogout)).toBe(false);
  expect(s.notice?.kind).toBe('warn');
});

it('a failed, cancelled or timed-out login leaves nothing behind', async () => {
  const cases: { name: string; login: (signal?: AbortSignal) => RunResult | Promise<RunResult>; cancel: boolean; notice: string | null }[] = [
    { name: 'exit 1', login: () => ({ code: 1, stdout: '', stderr: 'failed', timedOut: false, aborted: false }), cancel: false, notice: '로그인이 완료되지 않았습니다.' },
    { name: 'cancel', login: (signal) => untilAborted(signal), cancel: true, notice: null },
    { name: 'timeout', login: () => ({ code: null, stdout: '', stderr: '', timedOut: true, aborted: false }), cancel: false, notice: '로그인이 완료되지 않았습니다. 5분이 지나 중단했습니다.' },
  ];
  for (const k of cases) {
    const dataDir = tmp();
    seed(dataDir, [account('a', 'x@t.com', previous)]);
    const before = loadStore(dataDir);
    const { runner } = fakeRunner((c, signal) => isLogin(c) ? k.login(signal) : status('x@t.com'));
    const svc = service(dataDir, runner);
    const done = svc.addAccount();
    expect(svc.getState().login.inProgress, k.name).toBe(true);
    if (k.cancel) svc.cancelLogin();
    await done;
    const s = svc.getState();
    expect(existsSync(folder(dataDir, 'n1')), k.name).toBe(false);
    expect(existsSync(folder(dataDir, 'a')), k.name).toBe(true);
    expect(loadStore(dataDir), k.name).toEqual(before);
    expect(s.accounts.map(({ status: _s, failurePreview: _f, ...a }) => a), k.name).toEqual(before.accounts);
    expect(s.login.inProgress, k.name).toBe(false);
    if (k.notice === null) expect(s.notice, k.name).toBeNull();
    else expect(s.notice, k.name).toEqual({ kind: 'warn', text: k.notice });
  }
});

it('a login that ends without an account is rejected', async () => {
  const dataDir = tmp();
  seed(dataDir, [account('a', 'x@t.com', previous)]);
  const before = loadStore(dataDir);
  const { runner } = fakeRunner((c) => isLogin(c) ? ok('') : status(c.configDir === folder(dataDir, 'n1') ? null : 'x@t.com'));
  const svc = service(dataDir, runner);
  await svc.addAccount();
  expect(existsSync(folder(dataDir, 'n1'))).toBe(false);
  expect(loadStore(dataDir)).toEqual(before);
  expect(svc.getState().accounts.map((a) => a.id)).toEqual(['a']);
  expect(svc.getState().notice?.text).toBe('로그인이 완료되지 않았습니다.');
});

it('removeAccount logs out, deletes the folder and the entry', async () => {
  const dataDir = tmp();
  seed(dataDir, [account('a', 'x@t.com'), account('b', 'y@t.com')]);
  const { runner, calls } = fakeRunner(() => ok(''));
  const svc = service(dataDir, runner);
  await svc.removeAccount('a');
  expect(calls.some((c) => isLogout(c) && c.configDir === folder(dataDir, 'a'))).toBe(true);
  expect(existsSync(folder(dataDir, 'a'))).toBe(false);
  expect(svc.getState().accounts.map((a) => a.id)).toEqual(['b']);
  expect(loadStore(dataDir).accounts.map((a) => a.id)).toEqual(['b']);
});

it('the flame follows the average and the chosen mascot is saved', async () => {
  const dataDir = tmp();
  seed(dataDir, [account('a', 'a@t.com'), account('b', 'b@t.com'), account('c', 'c@t.com')]);
  const percents: Record<string, number> = { a: 100, b: 12, c: 71 };
  const { runner } = fakeRunner((c) => {
    if (!isUsage(c)) return status(null);
    const id = Object.keys(percents).find((k) => c.configDir === folder(dataDir, k))!;
    return ok(usageWith(percents[id]));
  });
  const svc = service(dataDir, runner);
  await svc.refresh('start');
  expect(svc.getState().mascot).toEqual({ id: 'flame', flameStage: 2 });
  svc.cycleMascot();
  expect(svc.getState().mascot.id).toBe('jellyfish');
  expect(loadStore(dataDir).mascot).toBe('jellyfish');
});

it('dispose cancels a login in progress', async () => {
  const dataDir = tmp();
  let loginSignal: AbortSignal | undefined;
  const { runner, calls } = fakeRunner((c, signal) => {
    if (isLogin(c)) { loginSignal = signal; return untilAborted(signal); }
    return status('y@t.com');
  });
  const svc = service(dataDir, runner);
  const done = svc.addAccount();
  svc.dispose();
  await done;
  expect(loginSignal?.aborted).toBe(true);
  expect(existsSync(folder(dataDir, 'n1'))).toBe(false);
  const made = calls.length;
  await svc.refresh('start');
  await svc.addAccount();
  expect(calls.length).toBe(made);
});

it('without Claude Code nothing runs', async () => {
  const dataDir = tmp();
  const svc = service(dataDir, null);
  expect(svc.getState().claude.found).toBe(false);
  const before = svc.getState();
  await svc.refresh('start');
  await svc.addAccount();
  expect(svc.getState()).toEqual(before);
  expect(existsSync(join(dataDir, 'profiles'))).toBe(false);
});

function gate() {
  let open!: (r: RunResult) => void;
  const wait = new Promise<RunResult>((resolve) => { open = resolve; });
  return { wait, open };
}
const tick = () => new Promise((r) => setTimeout(r, 10));

it('a removal in progress blocks reads in that folder and new logins', async () => {
  const dataDir = tmp();
  seed(dataDir, [account('a', 'x@t.com'), account('b', 'y@t.com')]);
  const pendingLogout = gate();
  const { runner, calls } = fakeRunner((c) => {
    if (isLogout(c)) return pendingLogout.wait;
    return isUsage(c) ? ok(loggedIn) : status('x@t.com');
  });
  const svc = service(dataDir, runner);
  const removing = svc.removeAccount('a');
  await tick();
  await svc.refresh('focus');
  const adding = svc.addAccount();
  pendingLogout.open(ok(''));
  await removing;
  await adding;
  expect(calls.filter((c) => c.configDir === folder(dataDir, 'a') && !isLogout(c))).toEqual([]);
  expect(calls.some(isLogin)).toBe(false);
  expect(existsSync(folder(dataDir, 'a'))).toBe(false);
});

it('a refresh during relogin cleanup does not touch the old folder', async () => {
  const dataDir = tmp();
  seed(dataDir, [account('old', 'x@t.com')]);
  const pendingLogout = gate();
  const { runner, calls } = fakeRunner((c) => {
    if (isLogin(c)) return ok('Login successful.');
    if (isLogout(c)) return pendingLogout.wait;
    return isUsage(c) ? ok(loggedIn) : status('x@t.com');
  });
  const svc = service(dataDir, runner);
  const relogin = svc.relogin('old');
  await tick();
  await svc.refresh('focus');
  pendingLogout.open(ok(''));
  await relogin;
  expect(calls.filter((c) => c.configDir === folder(dataDir, 'old') && !isLogout(c))).toEqual([]);
  expect(existsSync(folder(dataDir, 'old'))).toBe(false);
});

it('a failed save after a login does not leave the login in progress', async () => {
  const dataDir = tmp();
  const { runner } = fakeRunner((c) => isLogin(c) ? ok('Login successful.') : status('y@t.com'));
  const svc = service(dataDir, runner);
  mkdirSync(join(dataDir, 'accounts.json.tmp')); // saveStore cannot write its temp file
  await expect(svc.addAccount()).rejects.toThrow();
  expect(svc.getState().login.inProgress).toBe(false);
});

it('dispose during relogin cleanup still deletes the old folder without starting a logout', async () => {
  const dataDir = tmp();
  seed(dataDir, [account('old', 'x@t.com')]);
  const pendingUsage = gate();
  const { runner, calls } = fakeRunner((c) => {
    if (isLogin(c)) return ok('Login successful.');
    if (isUsage(c)) return pendingUsage.wait;
    return status('x@t.com');
  });
  const svc = service(dataDir, runner);
  const reading = svc.refresh('start');
  const relogin = svc.relogin('old'); // succeeds, then waits for the running read before cleaning up
  await tick();
  svc.dispose();
  pendingUsage.open(ok(loggedIn));
  await reading;
  await relogin;
  expect(existsSync(folder(dataDir, 'old'))).toBe(false);
  expect(calls.some(isLogout)).toBe(false);
});

it('the --safe-mode retry does not start after dispose', async () => {
  const dataDir = tmp();
  seed(dataDir, [account('a', 'x@t.com')]);
  let svc: AccountsService | undefined;
  const { runner, calls } = fakeRunner((c) => {
    if (isUsage(c)) {
      svc!.dispose();
      return { code: 1, stdout: '', stderr: "error: unknown option '--safe-mode'", timedOut: false, aborted: false };
    }
    return status('x@t.com');
  });
  svc = service(dataDir, runner);
  await svc.refresh('start');
  expect(calls.filter(isUsage)).toHaveLength(1);
});

// A status read that printed nothing (timeout, spawn error, a binary locked mid-update).
const noStatus: RunResult = { code: null, stdout: '', stderr: 'spawn EBUSY', timedOut: false, aborted: false };

it('refresh keeps last values as stale when the follow-up status cannot be read', async () => {
  const dataDir = tmp();
  seed(dataDir, [account('a', 'x@t.com', previous)]);
  const { runner } = fakeRunner((c) => isUsage(c) ? ok('boom') : noStatus);
  const svc = service(dataDir, runner);
  await svc.refresh('start');
  const a = svc.getState().accounts[0];
  expect(a.status).toBe('stale');
  expect(a.failurePreview).toEqual(['boom']);
  expect(a.lines).toEqual(previous);
});

it('a login whose first status read fails is confirmed by a second read', async () => {
  const dataDir = tmp();
  let statusReads = 0;
  const { runner } = fakeRunner((c) => {
    if (isLogin(c)) return ok('Login successful.');
    if (isStatus(c) && c.configDir === folder(dataDir, 'n1')) return ++statusReads === 1 ? noStatus : status('y@t.com');
    return isStatus(c) ? status(null) : ok(loggedIn);
  });
  const svc = service(dataDir, runner);
  await svc.addAccount();
  expect(statusReads).toBe(2);
  expect(svc.getState().accounts.map((a) => [a.id, a.email])).toEqual([['n1', 'y@t.com']]);
  expect(existsSync(folder(dataDir, 'n1'))).toBe(true);
});

it('a login whose status cannot be read twice leaves nothing behind', async () => {
  const dataDir = tmp();
  seed(dataDir, [account('a', 'x@t.com', previous)]);
  const before = loadStore(dataDir);
  const { runner, calls } = fakeRunner((c) => {
    if (isLogin(c)) return ok('Login successful.');
    return isStatus(c) && c.configDir === folder(dataDir, 'n1') ? noStatus : status('x@t.com');
  });
  const svc = service(dataDir, runner);
  await svc.addAccount();
  expect(calls.filter((c) => isStatus(c) && c.configDir === folder(dataDir, 'n1'))).toHaveLength(2);
  expect(existsSync(folder(dataDir, 'n1'))).toBe(false);
  expect(loadStore(dataDir)).toEqual(before);
  expect(svc.getState().accounts.map((a) => a.id)).toEqual(['a']);
  expect(svc.getState().notice).toEqual({ kind: 'warn', text: '로그인 상태를 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.' });
});

it('a model call stops the accounts not yet started in that refresh', async () => {
  const dataDir = tmp();
  seed(dataDir, ['a', 'b', 'c', 'd', 'e'].map((id) => account(id, `${id}@t.com`)));
  const modelUsed = json({ ...JSON.parse(loggedIn), num_turns: 1 });
  const { runner, calls } = fakeRunner((c) => {
    if (!isUsage(c)) return status(null);
    return ok(c.configDir === folder(dataDir, 'a') ? modelUsed : loggedIn);
  });
  const svc = service(dataDir, runner);
  await svc.refresh('start');
  expect(calls.filter(isUsage).length).toBeLessThan(5);
  const s = svc.getState();
  expect(s.autoRefreshPaused).toBe(true);
  expect(s.accounts.some((a) => a.status === 'loading')).toBe(false);
});

it('removeAccount still reports the new list when the save fails', async () => {
  const dataDir = tmp();
  seed(dataDir, [account('a', 'x@t.com'), account('b', 'y@t.com')]);
  const seen: string[][] = [];
  const { runner } = fakeRunner(() => ok(''));
  const svc = new AccountsService({ dataDir, runner, claudeVersion: '2.1.319', now: () => new Date(), newId: () => 'n1', onChange: (s) => seen.push(s.accounts.map((a) => a.id)) });
  mkdirSync(join(dataDir, 'accounts.json.tmp')); // saveStore cannot write its temp file
  await expect(svc.removeAccount('a')).rejects.toThrow();
  expect(seen.at(-1)).toEqual(['b']);
});

const ids = (svc: AccountsService) => svc.getState().accounts.map((a) => a.id);
const savedIds = (dataDir: string) => loadStore(dataDir).accounts.map((a) => a.id);

it('moveAccount moves a card down and up and saves the order', () => {
  const dataDir = tmp();
  seed(dataDir, [account('a', 'a@t.com'), account('b', 'b@t.com'), account('c', 'c@t.com')]);
  const svc = service(dataDir, fakeRunner(() => ok('')).runner);
  svc.moveAccount('a', 2);
  expect(ids(svc)).toEqual(['b', 'c', 'a']);
  expect(savedIds(dataDir)).toEqual(['b', 'c', 'a']);
  svc.moveAccount('a', 0);
  expect(ids(svc)).toEqual(['a', 'b', 'c']);
  svc.moveAccount('c', 1);
  expect(ids(svc)).toEqual(['a', 'c', 'b']);
  expect(savedIds(dataDir)).toEqual(['a', 'c', 'b']);
});

it('moveAccount clamps the index and ignores an unknown id', () => {
  const dataDir = tmp();
  seed(dataDir, [account('a', 'a@t.com'), account('b', 'b@t.com'), account('c', 'c@t.com')]);
  const svc = service(dataDir, fakeRunner(() => ok('')).runner);
  svc.moveAccount('a', 99);
  expect(ids(svc)).toEqual(['b', 'c', 'a']);
  svc.moveAccount('a', -5);
  expect(ids(svc)).toEqual(['a', 'b', 'c']);
  svc.moveAccount('zz', 0);
  expect(ids(svc)).toEqual(['a', 'b', 'c']);
  expect(savedIds(dataDir)).toEqual(['a', 'b', 'c']);
});

it('moveAccount does nothing while a login or a removal runs, or after dispose', async () => {
  const dataDir = tmp();
  seed(dataDir, [account('a', 'a@t.com'), account('b', 'b@t.com'), account('c', 'c@t.com')]);
  const pendingLogout = gate();
  const { runner } = fakeRunner((c, signal) => isLogin(c) ? untilAborted(signal) : isLogout(c) ? pendingLogout.wait : status(null));
  const svc = service(dataDir, runner);
  const login = svc.addAccount();
  svc.moveAccount('b', 0);
  expect(ids(svc)).toEqual(['a', 'b', 'c']);
  expect(savedIds(dataDir)).toEqual(['a', 'b', 'c']);
  svc.cancelLogin();
  await login;
  const removing = svc.removeAccount('c');
  await tick();
  svc.moveAccount('b', 0);
  expect(ids(svc)).toEqual(['a', 'b', 'c']);
  pendingLogout.open(ok(''));
  await removing;
  svc.dispose();
  svc.moveAccount('b', 0);
  expect(savedIds(dataDir)).toEqual(['a', 'b']);
});

it('moveAccount during a refresh keeps the results of the reads', async () => {
  const dataDir = tmp();
  seed(dataDir, [account('a', 'a@t.com'), account('b', 'b@t.com')]);
  const pending = gate();
  const { runner } = fakeRunner((c) => {
    if (!isUsage(c)) return status(null);
    return c.configDir === folder(dataDir, 'a') ? pending.wait : ok(usageWith(30));
  });
  const svc = service(dataDir, runner);
  const reading = svc.refresh('start');
  await tick(); // b is read, a is still running
  svc.moveAccount('a', 1);
  pending.open(ok(usageWith(70)));
  await reading;
  const s = svc.getState();
  expect(s.accounts.map((a) => [a.id, a.status, a.lines[0]?.percent])).toEqual([['b', 'ok', 30], ['a', 'ok', 70]]);
  expect(loadStore(dataDir).accounts.map((a) => [a.id, a.lines[0]?.percent])).toEqual([['b', 30], ['a', 70]]);
});

it('a failed read shows only what Claude Code printed on stdout', async () => {
  const dataDir = tmp();
  seed(dataDir, [account('a', 'x@t.com', previous)]);
  const { runner } = fakeRunner((c) =>
    isUsage(c) ? { code: 1, stdout: '', stderr: 'some error\nmore', timedOut: false, aborted: false } : status('x@t.com'));
  const svc = service(dataDir, runner);
  await svc.refresh('start');
  const a = svc.getState().accounts[0];
  expect(a.status).toBe('stale');
  expect(a.failurePreview).toEqual([]);
});

it('setZoom keeps the level within -3 to +3 and saves it', () => {
  const dataDir = tmp();
  seed(dataDir, [account('a', 'a@t.com')]);
  const svc = service(dataDir, fakeRunner(() => ok('')).runner);
  svc.setZoom(1.5);
  expect(loadStore(dataDir).zoom).toBe(1.5);
  svc.setZoom(10);
  expect(loadStore(dataDir).zoom).toBe(3);
  svc.setZoom(-10);
  expect(loadStore(dataDir).zoom).toBe(-3);
  expect(loadStore(dataDir).accounts.map((a) => a.id)).toEqual(['a']);
});

it('setAutoRefresh saves the choice and reports it in the state', () => {
  const dataDir = tmp();
  seed(dataDir, [account('a', 'a@t.com')]);
  const seen: boolean[] = [];
  const svc = new AccountsService({ dataDir, runner: fakeRunner(() => ok('')).runner, claudeVersion: '2.1.319', now: () => new Date(), newId: () => 'n1', onChange: (s) => seen.push(s.autoRefresh) });
  expect(svc.getState().autoRefresh).toBe(true);
  svc.setAutoRefresh(false);
  expect(seen).toEqual([false]);
  expect(loadStore(dataDir).autoRefresh).toBe(false);
  expect(service(dataDir, null).getState().autoRefresh).toBe(false); // read back by a new service, as after a rebuild
  svc.setAutoRefresh(true);
  expect(seen).toEqual([false, true]);
  expect(loadStore(dataDir).autoRefresh).toBe(true);
});

// The info-notice timer runs on vitest's fake clock; nothing waits ten real seconds.
afterEach(() => { vi.useRealTimers(); });

function noticeService() {
  const dataDir = tmp();
  const seen: (string | null)[] = [];
  const svc = new AccountsService({ dataDir, runner: fakeRunner(() => ok('')).runner, claudeVersion: '2.1.319', now: () => new Date(), newId: () => 'n1', onChange: (s) => seen.push(s.notice?.text ?? null) });
  return { svc, seen };
}

it('an info notice closes by itself after ten seconds', () => {
  vi.useFakeTimers();
  const { svc, seen } = noticeService();
  svc.showNotice({ kind: 'info', text: 'done' });
  vi.advanceTimersByTime(9_999);
  expect(svc.getState().notice?.text).toBe('done');
  vi.advanceTimersByTime(1);
  expect(svc.getState().notice).toBeNull();
  expect(seen).toEqual(['done', null]);
  expect(vi.getTimerCount()).toBe(0);
});

it('a warn notice stays', () => {
  vi.useFakeTimers();
  const { svc, seen } = noticeService();
  svc.showNotice({ kind: 'warn', text: 'careful' });
  vi.advanceTimersByTime(60_000);
  expect(svc.getState().notice?.text).toBe('careful');
  expect(seen).toEqual(['careful']);
});

it('a notice set later is not closed by the earlier notice\'s timer', () => {
  vi.useFakeTimers();
  const { svc } = noticeService();
  svc.showNotice({ kind: 'info', text: 'first' });
  vi.advanceTimersByTime(5_000);
  svc.showNotice({ kind: 'info', text: 'second' });
  vi.advanceTimersByTime(5_000); // the first one's ten seconds are up
  expect(svc.getState().notice?.text).toBe('second');
  vi.advanceTimersByTime(5_000);
  expect(svc.getState().notice).toBeNull();

  svc.showNotice({ kind: 'info', text: 'third' });
  vi.advanceTimersByTime(5_000);
  svc.showNotice({ kind: 'warn', text: 'fourth' });
  vi.advanceTimersByTime(60_000);
  expect(svc.getState().notice?.text).toBe('fourth');
  expect(vi.getTimerCount()).toBe(0);
});

it('nothing fires after dispose', () => {
  vi.useFakeTimers();
  const { svc, seen } = noticeService();
  svc.showNotice({ kind: 'info', text: 'done' });
  svc.dispose();
  expect(vi.getTimerCount()).toBe(0);
  vi.advanceTimersByTime(10_000);
  expect(seen).toEqual(['done']);
});

it('the registration notice closes by itself', async () => {
  vi.useFakeTimers();
  const dataDir = tmp();
  const { runner } = fakeRunner((c) => {
    if (isLogin(c)) return ok('Login successful.');
    return isStatus(c) ? status(c.configDir === folder(dataDir, 'n1') ? 'y@t.com' : null) : ok(loggedIn);
  });
  const svc = service(dataDir, runner);
  await svc.addAccount();
  expect(svc.getState().notice).toEqual({ kind: 'info', text: 'y@t.com 계정을 등록했습니다.' });
  vi.advanceTimersByTime(10_000);
  expect(svc.getState().notice).toBeNull();
});

it('setZoom does not rewrite the file when the level has not changed', () => {
  const dataDir = tmp();
  seed(dataDir, [account('a', 'a@t.com')]);
  const svc = service(dataDir, fakeRunner(() => ok('')).runner);
  svc.setZoom(3);
  const file = join(dataDir, 'accounts.json');
  rmSync(file);
  svc.setZoom(3);
  svc.setZoom(5); // clamps to the same 3
  expect(existsSync(file)).toBe(false);
  svc.setZoom(2.5);
  expect(loadStore(dataDir).zoom).toBe(2.5);
});

it('a timer read does nothing while auto refresh is off; other reads still run', async () => {
  const dataDir = tmp();
  seed(dataDir, [account('a', 'x@t.com')]);
  const t0 = new Date(2026, 10, 6, 16, 0).getTime(); let t = new Date(t0);
  const { runner, calls } = fakeRunner((c) => isUsage(c) ? ok(loggedIn) : status('x@t.com'));
  const svc = service(dataDir, runner, () => t);
  svc.setAutoRefresh(false);
  await svc.refresh('timer');
  expect(calls).toEqual([]);
  await svc.refresh('start');
  const afterStart = calls.length;
  expect(afterStart).toBeGreaterThan(0);
  t = new Date(t0 + 10 * 60_000);
  await svc.refresh('timer');
  expect(calls.length).toBe(afterStart);
  await svc.refresh('focus');
  const afterFocus = calls.length;
  expect(afterFocus).toBeGreaterThan(afterStart);
  t = new Date(t0 + 20 * 60_000);
  await svc.refresh('manual');
  expect(calls.length).toBeGreaterThan(afterFocus);
  svc.setAutoRefresh(true);
  t = new Date(t0 + 30 * 60_000);
  const beforeTimer = calls.length;
  await svc.refresh('timer');
  expect(calls.length).toBeGreaterThan(beforeTimer);
});
