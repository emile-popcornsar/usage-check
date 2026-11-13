import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const now = Date.now();
const at = (ms) => new Date(now + ms).toISOString(); // relative to now, so screenshots never go stale
const EMAILS = ['account1@example.com', 'account2@example.com', 'account3@example.com'];

const status = (email, expiresIn) => ({ loggedIn: true, authMethod: 'claude.ai', email, planTier: 'max_20x', loginExpiresAt: at(expiresIn) });
const usage = (all, fable, resets, expiresIn) => ({
  is_error: false, num_turns: 0, total_cost_usd: 0, local_command: 'usage', credential_expires_at: at(expiresIn),
  result: 'You are currently using your subscription to power your Claude Code usage\n\n'
    + `Current week (all models): ${all}% used · resets ${resets} (Asia/Seoul)\n`
    + `Current week (Fable): ${fable}% used · resets ${resets} (Asia/Seoul)`,
});
const lines = (all, fable, resets) => [
  { label: 'Current week (all models)', percent: all, resetsText: `${resets} (Asia/Seoul)` },
  { label: 'Current week (Fable)', percent: fable, resetsText: `${resets} (Asia/Seoul)` },
];
// One account: what Claude Code says in its folder (`usage` null = no fake.json, i.e. logged out) and what the store remembers.
const account = (i, { all, fable, resets, expiresIn, usage: raw, saved }) => ({
  email: EMAILS[i],
  expiresIn,
  fake: raw === null ? null : { status: status(EMAILS[i], expiresIn), usage: raw ?? usage(all, fable, resets, expiresIn) },
  saved: saved ?? null,
});

const NORMAL = [
  account(0, { all: 19, fable: 20, resets: 'Nov 11, 7am', expiresIn: 27 * DAY + HOUR }),
  account(1, { all: 0, fable: 1, resets: 'Nov 13, 8am', expiresIn: 29 * DAY + HOUR }),
  account(2, { all: 62, fable: 58, resets: 'Nov 16, 2pm', expiresIn: 28 * DAY + HOUR }),
];

// `settings` go into accounts.json next to the accounts (the stored zoom and auto-refresh choice).
const SCENARIOS = {
  empty: { accounts: [] },
  normal: { accounts: NORMAL },
  'zoom-large': { accounts: NORMAL, settings: { zoom: 3 } },
  'auto-off': { accounts: NORMAL, settings: { autoRefresh: false } },
  'old-claude': { accounts: NORMAL, claudeVersion: '2.1.300' }, // below MIN_CLAUDE_VERSION: the footer asks for an update
  limit: {
    accounts: [
      account(0, { all: 100, fable: 94, resets: 'Nov 11, 7am', expiresIn: 24 * DAY + HOUR }),
      account(1, { all: 12, fable: 15, resets: 'Nov 13, 8am', expiresIn: 26 * DAY + HOUR }),
      account(2, { all: 71, fable: 66, resets: 'Nov 16, 2pm', expiresIn: 25 * DAY + HOUR }),
    ],
  },
  'login-required': {
    accounts: [
      account(0, { all: 34, fable: 40, resets: 'Nov 14, 7am', expiresIn: 2 * DAY + HOUR }),
      account(1, { all: 8, fable: 9, resets: 'Nov 15, 8am', expiresIn: 4 * DAY + HOUR }),
      account(2, { usage: null, expiresIn: -DAY, saved: { lines: lines(100, 97, 'Nov 12, 2pm'), fetchedAt: at(-3 * DAY) } }),
    ],
  },
  'expiry-soon': {
    accounts: [
      account(0, { all: 19, fable: 20, resets: 'Nov 11, 7am', expiresIn: 27 * DAY + HOUR }),
      account(1, { all: 43, fable: 47, resets: 'Nov 13, 8am', expiresIn: 2 * DAY + HOUR }),
      account(2, { all: 62, fable: 58, resets: 'Nov 16, 2pm', expiresIn: 28 * DAY + HOUR }),
    ],
  },
  stale: {
    accounts: [
      account(0, {
        expiresIn: 25 * DAY + HOUR,
        usage: 'Error: Rate limited. Please try again later.\nRequest was throttled for this account (status 429).\nRetry after: 5 minutes\nThis fourth line is not shown.',
        saved: { lines: lines(47, 52, 'Nov 11, 7am'), fetchedAt: at(-12 * MIN) },
      }),
      account(1, { all: 12, fable: 15, resets: 'Nov 13, 8am', expiresIn: 27 * DAY + HOUR }),
      account(2, { all: 71, fable: 66, resets: 'Nov 16, 2pm', expiresIn: 26 * DAY + HOUR }),
    ],
  },
  'no-claude': { accounts: [], claudeMissing: true },
};

const scenario = process.argv[2];
const spec = SCENARIOS[scenario];
if (!spec) {
  console.error(`사용법: node scripts/smoke.mjs <${Object.keys(SCENARIOS).join('|')}>`);
  process.exit(1);
}

const root = mkdtempSync(join(tmpdir(), 'usage-check-smoke-'));
const dataDir = join(root, 'data');
const defaultLogin = join(root, 'default-login.json');
mkdirSync(join(dataDir, 'profiles'), { recursive: true });
const stored = spec.accounts.map((a, i) => {
  const id = `smoke-${i + 1}`;
  const folder = join(dataDir, 'profiles', id);
  mkdirSync(folder, { recursive: true });
  if (a.fake) writeFileSync(join(folder, 'fake.json'), JSON.stringify(a.fake));
  return {
    id, email: a.email, addedAt: at(-30 * DAY),
    lines: a.saved?.lines ?? [], fetchedAt: a.saved?.fetchedAt ?? null, credentialExpiresAt: at(a.expiresIn),
  };
});
writeFileSync(join(dataDir, 'accounts.json'), JSON.stringify({ version: 1, mascot: 'flame', claudePath: null, ...spec.settings, accounts: stored }, null, 2));
// The default login (no CLAUDE_CONFIG_DIR) is the first account.
writeFileSync(defaultLogin, JSON.stringify({ status: status(EMAILS[0], 27 * DAY) }));

mkdirSync('artifacts', { recursive: true });
const png = resolve('artifacts', `smoke-${scenario}.png`);
rmSync(png, { force: true });

const env = {
  ...process.env,
  USAGE_CHECK_DATA_DIR: dataDir,
  USAGE_CHECK_SMOKE: png,
  USAGE_CHECK_CLAUDE_PATH: spec.claudeMissing ? join(root, 'missing', 'claude.exe') : resolve('tests', 'fixtures', 'fake-claude.cmd'),
  FAKE_CLAUDE_DEFAULT: defaultLogin,
  FAKE_CLAUDE_VERSION: spec.claudeVersion ?? '', // empty: the fake's own default version
};
// A CLAUDE_CONFIG_DIR from the developer's shell would point the fake's default login at a real folder.
for (const key of Object.keys(env)) {
  if (['CLAUDE_CONFIG_DIR', 'ELECTRON_RUN_AS_NODE'].includes(key.toUpperCase())) delete env[key];
}

const timeout = 180_000;
const child = spawn(createRequire(import.meta.url)('electron'), ['.'], { env, stdio: 'inherit' });
const result = await new Promise((done) => {
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    // End the whole tree by PID (never by image name).
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGKILL');
  }, timeout);
  child.on('error', (error) => { clearTimeout(timer); done({ status: null, error }); });
  child.on('exit', (status) => { clearTimeout(timer); done({ status, error: timedOut ? new Error(`시간 초과 (${timeout / 1000}초), 프로세스 트리를 종료함`) : null }); });
});
try { rmSync(root, { recursive: true, force: true, maxRetries: 5 }); } catch (error) { console.warn(`임시 폴더 정리 실패: ${error.message}`); }

let size = 0;
try { size = statSync(png).size; } catch { /* no file */ }
if (result.error || result.status !== 0 || size <= 0) {
  console.error(`smoke 실패: 종료 코드 ${result.status}${result.error ? ` (${result.error.message})` : ''}, PNG ${size} bytes`);
  process.exit(1);
}
console.log(`smoke 통과: ${png} (${size} bytes)`);
