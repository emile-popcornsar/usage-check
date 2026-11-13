// Fake Claude Code for tests and smoke runs.
import { existsSync, readFileSync, copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const LOGGED_OUT_USAGE = {
  is_error: false, num_turns: 0, total_cost_usd: 0, local_command: 'usage',
  result: 'Total cost:            $0.0000\nTotal duration (API):  0s\nTotal duration (wall): 1s\nTotal code changes:    0 lines added, 0 lines removed',
};

const configDir = process.env.CLAUDE_CONFIG_DIR;
const stateFile = () => (configDir ? join(configDir, 'fake.json') : process.env.FAKE_CLAUDE_DEFAULT);
const readState = () => {
  const f = stateFile();
  if (!f || !existsSync(f)) return null;
  return JSON.parse(readFileSync(f, 'utf8'));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (args[0] === '--version') {
  console.log(`${process.env.FAKE_CLAUDE_VERSION || '2.1.319'} (Claude Code)`);
} else if (args[0] === 'auth' && args[1] === 'status') {
  const state = readState();
  const status = state && state.status !== undefined ? state.status : { loggedIn: false };
  console.log(JSON.stringify(status, null, 2));
  process.exit(status.loggedIn === true ? 0 : 1);
} else if (args[0] === '-p') {
  const state = readState();
  const usage = state && state.usage !== undefined ? state.usage : LOGGED_OUT_USAGE;
  console.log(typeof usage === 'string' ? usage : JSON.stringify(usage));
} else if (args[0] === 'auth' && args[1] === 'login') {
  const src = process.env.FAKE_CLAUDE_LOGIN;
  if (!src) process.exit(1);
  copyFileSync(src, join(configDir, 'fake.json'));
  console.log('Login successful.');
  const delay = JSON.parse(readFileSync(src, 'utf8')).delayMs;
  if (delay) await sleep(delay);
} else if (args[0] === 'auth' && args[1] === 'logout') {
  rmSync(join(configDir, 'fake.json'), { force: true });
} else if (args[0] === 'echo-env') {
  console.log(JSON.stringify({
    CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    cwd: process.cwd(),
    args,
  }));
} else if (args[0] === 'sleep') {
  await sleep(60_000);
}
