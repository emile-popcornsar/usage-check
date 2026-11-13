import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AppState } from '../core/types';
import { AUTO_REFRESH_MS, focusNeedsRefresh, periodicReadDue } from '../core/refreshPolicy';
import { nextZoom, zoomStepForKey, type ZoomStep } from '../core/zoom';
import { AccountsService } from './accountsService';
import { claudeUsable, createRunner, findClaude, type ClaudeRunner } from './claudeCli';
import { readVersion } from './claudeCommands';
import { loadStore, saveStore } from './store';

if (process.env.USAGE_CHECK_DATA_DIR) {
  app.setPath('userData', process.env.USAGE_CHECK_DATA_DIR);
}

const dataDir = process.env.USAGE_CHECK_DATA_DIR || app.getPath('userData');
const workDir = join(dataDir, 'workdir');
const smokePath = process.env.USAGE_CHECK_SMOKE;
// How long closing or rebuilding waits for a cancelled login or a removal to tidy up its folder.
const STOP_WAIT_MS = 8_000;
// The window title carries the running version, e.g. "Usage Check (v0.1.0)".
const TITLE = `Usage Check (v${app.getVersion()})`;

let win: BrowserWindow | null = null;
let service: AccountsService | null = null;
let runner: ClaudeRunner | null = null;
let ready: Promise<void> = Promise.resolve(); // the latest start or rebuild of the service
let rebuilding = false;
let quitting = false;
let firstReadDone = false;
let captured = false;
let timer: NodeJS.Timeout | undefined;
let zoomLevel = 0; // the window's zoom; read from the store when the window is made
let zoomChanged = false; // the user zoomed since start-up, so a newly made service must save zoomLevel
let picking = false; // the file dialog or the --version check of a picked file is open
let pickRunner: ClaudeRunner | null = null; // runs --version on a picked file; closing ends it
const inFlight = new Set<Promise<void>>();

const logError = (e: unknown) => console.error(e);

// Every service call goes through here, so none of them can end as an unhandled rejection.
function track(p: Promise<void>): Promise<void> {
  const settled: Promise<void> = p.catch(logError).finally(() => inFlight.delete(settled));
  inFlight.add(settled);
  return settled;
}

function safely(fn: () => void): void {
  try {
    fn();
  } catch (e) {
    logError(e);
  }
}

function publish(s: AppState): void {
  if (win && !win.isDestroyed()) win.webContents.send('state:changed', s);
}

async function startService(): Promise<void> {
  const fromEnv = process.env.USAGE_CHECK_CLAUDE_PATH;
  const saved = fromEnv === undefined ? loadStore(dataDir).claudePath : null;
  const claudePath = findClaude({
    override: fromEnv ?? saved,
    exclusive: fromEnv !== undefined,
    env: process.env,
    platform: process.platform,
    homeDir: homedir(),
    exists: existsSync,
  });
  let r = claudePath === null ? null : createRunner(claudePath, workDir, process.env);
  let version = r === null ? null : await readVersion(r);
  if (r !== null && !claudeUsable(claudePath, saved, version)) {
    r.dispose(); // a saved path that is not Claude Code: show the no-claude screen so it can be replaced
    r = null;
    version = null;
  }
  if (quitting) {
    r?.dispose();
    return;
  }
  runner = r;
  service = new AccountsService({ dataDir, runner: r, claudeVersion: version, now: () => new Date(), newId: randomUUID, onChange: publish });
  // A zoom chosen while there was no service (start-up, rebuild) was applied but not saved. Never the level read
  // back from the page: before dom-ready that is 0 and would overwrite the saved one.
  if (zoomChanged) safely(() => service?.setZoom(zoomLevel));
  publish(service.getState());
  void track(service.refresh('start')).then(() => {
    firstReadDone = true;
    if (service) publish(service.getState()); // makes the renderer paint, and report, the settled state at least once more
  });
}

// Spec: closing in the middle of a read or a login leaves no Claude Code process and no half-made account folder.
// dispose() cancels a login; its folder is removed only when that login call returns, so wait for the calls first.
async function stopService(): Promise<void> {
  const s = service;
  const r = runner;
  service = null;
  runner = null;
  s?.dispose();
  await new Promise<void>((resolve) => {
    const t = setTimeout(resolve, STOP_WAIT_MS);
    void Promise.all([...inFlight]).then(() => {
      clearTimeout(t);
      resolve();
    });
  });
  r?.dispose();
}

// Saves the path to use (null: search again) and starts the service over with it.
function rebuild(claudePath: string | null): void {
  if (rebuilding || quitting) return;
  rebuilding = true;
  ready = (async () => {
    await stopService();
    if (quitting) return;
    saveStore(dataDir, { ...loadStore(dataDir), claudePath });
    await startService();
  })()
    .catch(logError)
    .finally(() => {
      rebuilding = false;
    });
}

async function shutdown(code: number): Promise<void> {
  if (quitting) return;
  quitting = true;
  try {
    clearInterval(timer);
    win?.hide();
    pickRunner?.dispose();
    await ready;
    await stopService();
  } finally {
    app.exit(code); // even if a step throws: the window is hidden and further closes are ignored
  }
}

async function confirmRemove(id: string): Promise<void> {
  const account = service?.getState().accounts.find((a) => a.id === id);
  if (!win || !account) return;
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    message: `${account.email} 계정을 목록에서 삭제할까요?`,
    detail: '이 PC에 저장된 이 계정의 로그인도 함께 지워집니다.',
    buttons: ['삭제', '취소'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
  if (response === 0 && service) void track(service.removeAccount(id));
}

// A picked file is saved only if it answers --version; otherwise the no-claude screen stays with a notice.
async function pickClaudePath(): Promise<void> {
  if (!win || rebuilding || quitting || picking) return;
  picking = true;
  try {
    const picked = await dialog.showOpenDialog(win, {
      title: 'Claude Code 실행 파일 선택',
      properties: ['openFile'],
      filters: process.platform === 'win32' ? [{ name: 'Claude Code', extensions: ['exe', 'cmd'] }] : [],
    });
    if (picked.canceled || picked.filePaths.length === 0 || rebuilding || quitting) return;
    const path = picked.filePaths[0];
    const r = createRunner(path, workDir, process.env);
    pickRunner = r;
    const version = await readVersion(r).finally(() => {
      r.dispose();
      pickRunner = null;
    });
    if (rebuilding || quitting) return;
    if (version !== null) rebuild(path);
    else service?.showNotice({ kind: 'warn', text: '선택한 파일은 Claude Code가 아닌 것 같습니다. 다른 파일을 골라 주세요.' });
  } finally {
    picking = false;
  }
}

async function captureSmoke(path: string): Promise<void> {
  let code = 0;
  try {
    const image = await win!.webContents.capturePage();
    if (image.isEmpty()) throw new Error('captured image is empty');
    writeFileSync(path, image.toPNG());
  } catch (e) {
    console.error('smoke capture failed:', e);
    code = 1;
  }
  await shutdown(code);
}

function registerIpc(): void {
  ipcMain.handle('state:get', async () => {
    await ready;
    return service ? service.getState() : null;
  });
  ipcMain.on('action:refresh', () => { if (service) void track(service.refresh('manual')); });
  ipcMain.on('action:add-account', () => { if (service) void track(service.addAccount()); });
  ipcMain.on('action:relogin', (_e, id: unknown) => { if (service && typeof id === 'string') void track(service.relogin(id)); });
  ipcMain.on('action:cancel-login', () => safely(() => service?.cancelLogin()));
  ipcMain.on('action:remove-account', (_e, id: unknown) => { if (typeof id === 'string') confirmRemove(id).catch(logError); });
  ipcMain.on('action:move-account', (_e, id: unknown, toIndex: unknown) => {
    if (typeof id === 'string' && typeof toIndex === 'number' && Number.isInteger(toIndex)) safely(() => service?.moveAccount(id, toIndex));
  });
  ipcMain.on('action:cycle-mascot', () => safely(() => service?.cycleMascot()));
  ipcMain.on('action:set-auto-refresh', (_e, on: unknown) => { if (typeof on === 'boolean') safely(() => service?.setAutoRefresh(on)); });
  ipcMain.on('action:pick-claude-path', () => { pickClaudePath().catch(logError); });
  ipcMain.on('action:retry-find-claude', () => rebuild(null)); // forgets the saved path, then searches again
  ipcMain.on('ui:painted', () => {
    if (!smokePath || !firstReadDone || captured) return;
    captured = true;
    void captureSmoke(smokePath);
  });
}

function createWindow(): void {
  win = new BrowserWindow({
    useContentSize: true,
    width: 500,
    height: 840,
    minWidth: 420,
    minHeight: 480,
    title: TITLE,
    icon: join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false, // the spellchecker can download dictionaries; the program makes no network request of its own
    },
  });
  win.removeMenu();
  win.setTitle(TITLE);
  win.on('page-title-updated', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  // Zoom: the window has no menu, so Ctrl +/-/0 and Ctrl + wheel are handled here. The service remembers the level.
  const contents = win.webContents;
  zoomLevel = loadStore(dataDir).zoom;
  contents.on('dom-ready', () => contents.setZoomLevel(zoomLevel)); // a level set before the page has loaded is lost
  const zoom = (step: ZoomStep) => {
    const level = nextZoom(zoomLevel, step);
    if (level === zoomLevel) return; // already at a limit: nothing to apply or save
    zoomLevel = level;
    zoomChanged = true;
    contents.setZoomLevel(level);
    safely(() => service?.setZoom(level)); // without a service (start-up, rebuild) startService() saves it
  };
  contents.on('before-input-event', (e, input) => {
    const step = zoomStepForKey(input);
    if (step === null) return;
    e.preventDefault();
    zoom(step);
  });
  contents.on('zoom-changed', (_e, direction) => zoom(direction));

  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    void shutdown(0);
  });
  win.on('focus', () => {
    if (!service) return;
    const last = service.getState().lastFetchAt;
    if (focusNeedsRefresh(last === null ? null : Date.parse(last), Date.now())) void track(service.refresh('focus'));
  });

  void win.loadFile(join(__dirname, 'renderer', 'index.html'));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win || quitting) return; // do not bring back a window that is shutting down
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  app.whenReady().then(() => {
    mkdirSync(join(dataDir, 'profiles'), { recursive: true });
    mkdirSync(workDir, { recursive: true });
    registerIpc();
    ready = startService().catch(logError);
    createWindow();
    // The only periodic timer: made once here, cleared in shutdown(). Switching auto refresh or rebuilding the service
    // does not touch it; each tick asks the current service whether to read.
    timer = setInterval(() => {
      if (!service || !win) return;
      const s = service.getState();
      const due = periodicReadDue({ autoRefresh: s.autoRefresh, autoRefreshPaused: s.autoRefreshPaused, visible: win.isVisible(), minimized: win.isMinimized() });
      if (due) void track(service.refresh('timer'));
    }, AUTO_REFRESH_MS);
  }).catch((e: unknown) => {
    logError(e);
    app.exit(1);
  });
  app.on('window-all-closed', () => app.quit());
}
