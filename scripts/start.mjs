// `npm start`: brings this clone up to date, builds, and opens the program. Installing is its own step (`npm install`).
// When the update cannot run (no network, not a git clone) it says so in one line, and the copy that is here opens anyway.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const self = fileURLToPath(import.meta.url);
const require = createRequire(import.meta.url);
process.chdir(fileURLToPath(new URL('..', import.meta.url)));

const say = (text) => console.log(`[Usage Check] ${text}`);
const version = () => JSON.parse(readFileSync('package.json', 'utf8')).version;
const git = (args, timeout) => spawnSync('git', args, {
  encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
});
const head = () => {
  const r = git(['rev-parse', 'HEAD']);
  return r.status === 0 ? r.stdout.trim() : null;
};
// The packages a lock file asks for. This program's own version number is in the file too and is left out,
// so that a new version alone does not count as a change of packages.
const lockedPackages = (text) => {
  const packages = JSON.parse(text).packages;
  return JSON.stringify({ ...packages, '': { ...packages[''], version: undefined } });
};

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
  say(`Node.js 22.12 이상이 필요합니다 (지금 ${process.versions.node}).`);
  process.exit(1);
}

// Fast-forward only: local commits and edits are never merged over or lost; if they are in the way the pull just fails.
// Returns whether new commits arrived.
function update() {
  // Without its own .git this folder may sit inside some other repository, and that one must not be pulled.
  const before = existsSync('.git') ? head() : null;
  if (before === null) {
    say('git clone으로 받은 폴더가 아니어서 업데이트를 확인하지 않습니다.');
    return false;
  }
  const oldVersion = version();
  const pull = git(['pull', '--ff-only', '--quiet'], 30_000);
  if (pull.status !== 0) {
    const reason = (pull.stderr ?? '').split('\n').map((l) => l.trim()).find(Boolean);
    say(`업데이트를 확인하지 못해 지금 있는 버전으로 엽니다${reason ? ` (${reason})` : ''}.`);
    return false;
  }
  if (head() === before) return false;
  const newVersion = version();
  say(oldVersion === newVersion ? '최신 내용으로 업데이트했습니다.' : `새 버전으로 업데이트했습니다 (${oldVersion} → ${newVersion}).`);
  const oldLock = git(['show', `${before}:package-lock.json`]);
  if (oldLock.status === 0 && lockedPackages(oldLock.stdout) !== lockedPackages(readFileSync('package-lock.json', 'utf8'))) {
    say('이번 업데이트에는 새 부품이 필요합니다. npm install을 실행한 뒤 npm start를 다시 실행해 주세요.');
    process.exit(1);
  }
  return true;
}

if (!process.argv.includes('--skip-update') && update()) {
  // The update may have changed this file too: hand over to the new copy.
  const r = spawnSync(process.execPath, [self, '--skip-update'], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

let electron;
try {
  require.resolve('esbuild');
  electron = require('electron'); // the path of the Electron program
} catch {
  say('먼저 npm install을 실행해 주세요.');
  process.exit(1);
}
const built = spawnSync(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit' });
if (built.status !== 0) process.exit(built.status ?? 1);

const env = { ...process.env };
// Some hosts (an editor's terminal) set this, and with it Electron would start as plain Node instead of opening the window.
for (const key of Object.keys(env)) {
  if (key.toUpperCase() === 'ELECTRON_RUN_AS_NODE') delete env[key];
}
const app = spawn(electron, ['.'], { stdio: 'inherit', env });
app.on('error', (e) => {
  say(`프로그램을 열지 못했습니다 (${e.message}).`);
  process.exit(1);
});
app.on('exit', (code) => process.exit(code ?? 1));
