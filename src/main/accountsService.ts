import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { AccountStatus, AppState, Notice, StoreFile, StoredAccount } from '../core/types';
import { averageWeeklyPercent, flameStageFor, nextMascot } from '../core/mascot';
import { reconcileLogin } from '../core/reconcile';
import { COOLDOWN_MS, INFO_NOTICE_MS, isCoolingDown } from '../core/refreshPolicy';
import { clampZoom } from '../core/zoom';
import type { ClaudeRunner } from './claudeCli';
import { logout, readAuthStatus, readUsage, startLogin } from './claudeCommands';
import { loadStore, saveStore } from './store';

export type RefreshTrigger = 'start' | 'manual' | 'timer' | 'focus';
export type ServiceDeps = { dataDir: string; runner: ClaudeRunner | null; claudeVersion: string | null; now: () => Date; newId: () => string; onChange: (s: AppState) => void };

type Card = { status: AccountStatus; failurePreview: string[] | null };

const PARALLEL_READS = 3;
const LOADING: Card = { status: 'loading', failurePreview: null };
const LOGIN_FAILED = '로그인이 완료되지 않았습니다.';
const LOGIN_UNCONFIRMED = '로그인 상태를 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.';
const LOGIN_TIMED_OUT = ' 5분이 지나 중단했습니다.';

// Deletes an account folder without looking inside it. A folder that is still locked stays on disk and is never used again.
function removeFolder(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  } catch {
    // nothing else to do with it
  }
}

export class AccountsService {
  private readonly deps: ServiceDeps;
  private store: StoreFile;
  private readonly cards = new Map<string, Card>();
  private activeEmail: string | null = null;
  private notice: Notice | null = null;
  private noticeTimer: NodeJS.Timeout | null = null; // closes an info notice; replaced or cleared together with the notice
  private lastStart: number | null = null;
  private autoRefreshPaused = false;
  private reading: Promise<void> | null = null;
  private loginRunning = false;
  private removing = 0; // account folders being logged out and deleted; nothing may start in one meanwhile
  private cancelRunningLogin: (() => void) | null = null;
  private disposed = false;

  constructor(deps: ServiceDeps) {
    this.deps = deps;
    const loaded = loadStore(deps.dataDir);
    this.store = { ...loaded, mascot: loaded.mascot ?? 'flame' };
  }

  getState(): AppState {
    const { accounts, mascot } = this.store;
    return {
      claude: { found: this.deps.runner !== null, version: this.deps.claudeVersion },
      accounts: accounts.map((a) => ({ ...a, ...(this.cards.get(a.id) ?? LOADING) })),
      activeEmail: this.activeEmail,
      login: { inProgress: this.loginRunning },
      notice: this.notice,
      refreshing: this.reading !== null,
      lastFetchAt: this.lastStart === null ? null : new Date(this.lastStart).toISOString(),
      cooldownUntil: this.lastStart === null ? null : new Date(this.lastStart + COOLDOWN_MS).toISOString(),
      autoRefreshPaused: this.autoRefreshPaused,
      autoRefresh: this.store.autoRefresh,
      mascot: { id: mascot, flameStage: flameStageFor(averageWeeklyPercent(accounts)) },
    };
  }

  async refresh(trigger: RefreshTrigger): Promise<void> {
    const runner = this.deps.runner;
    if (!runner || this.disposed || this.reading || this.loginRunning || this.removing > 0) return;
    if (trigger === 'manual' && isCoolingDown(this.lastStart, this.deps.now().getTime())) return;
    if ((trigger === 'timer' || trigger === 'focus') && this.autoRefreshPaused) return;
    if (trigger === 'timer' && !this.store.autoRefresh) return; // main.ts checks this too; the toggle holds even if it did not
    await this.read(runner, this.store.accounts.map((a) => a.id));
  }

  addAccount(): Promise<void> {
    return this.login(null);
  }

  async relogin(id: string): Promise<void> {
    const account = this.find(id);
    if (account) await this.login(account.email);
  }

  cancelLogin(): void {
    this.cancelRunningLogin?.();
  }

  async removeAccount(id: string): Promise<void> {
    const runner = this.deps.runner;
    if (!runner || this.disposed || !this.find(id)) return;
    this.removing++;
    try {
      await this.readsDone(); // a read may still be running in that folder
      if (this.disposed) return;
      await logout(runner, this.folder(id));
      removeFolder(this.folder(id));
      this.store = { ...this.store, accounts: this.store.accounts.filter((a) => a.id !== id) };
      this.cards.delete(id);
      saveStore(this.deps.dataDir, this.store);
    } finally {
      this.removing--;
      this.emit(); // even if the save failed: the screen must not keep a card that is gone
    }
  }

  // The order of the list is the order on screen. Built from the current store, so a read that finished meanwhile is kept.
  moveAccount(id: string, toIndex: number): void {
    if (this.disposed || this.loginRunning || this.removing > 0) return;
    const from = this.store.accounts.findIndex((a) => a.id === id);
    if (from < 0) return;
    const accounts = this.store.accounts.filter((a) => a.id !== id);
    const to = Math.max(0, Math.min(accounts.length, toIndex));
    if (to === from) return;
    accounts.splice(to, 0, this.store.accounts[from]);
    this.store = { ...this.store, accounts };
    try {
      saveStore(this.deps.dataDir, this.store);
    } finally {
      this.emit();
    }
  }

  // For the main process's own messages, such as a picked file that is not Claude Code.
  showNotice(notice: Notice): void {
    this.setNotice(notice);
    this.emit();
  }

  cycleMascot(): void {
    this.store = { ...this.store, mascot: nextMascot(this.store.mascot) };
    saveStore(this.deps.dataDir, this.store);
    this.emit();
  }

  // The window applies the zoom itself; the service only remembers it, so nothing on screen changes here.
  setZoom(level: number): void {
    const zoom = clampZoom(level);
    if (zoom === this.store.zoom) return; // a held key or a touchpad sends many steps at a limit
    this.store = { ...this.store, zoom };
    saveStore(this.deps.dataDir, this.store);
  }

  // Only remembered and reported here; the main process's periodic timer reads it on every tick.
  setAutoRefresh(on: boolean): void {
    this.store = { ...this.store, autoRefresh: on };
    try {
      saveStore(this.deps.dataDir, this.store);
    } finally {
      this.emit();
    }
  }

  // Stops a login in progress and starts nothing new. Running reads are ended by the runner's own dispose.
  dispose(): void {
    this.disposed = true;
    this.stopNoticeTimer();
    this.cancelRunningLogin?.();
  }

  // Spec 3.1: an info notice closes by itself after ten seconds, unless another one has replaced it by then; a warning stays.
  private setNotice(notice: Notice | null): void {
    this.stopNoticeTimer();
    this.notice = notice;
    if (notice?.kind !== 'info' || this.disposed) return;
    const timer = setTimeout(() => {
      this.noticeTimer = null;
      if (this.notice !== notice) return;
      this.notice = null;
      this.emit();
    }, INFO_NOTICE_MS);
    timer.unref(); // never what keeps the process running
    this.noticeTimer = timer;
  }

  private stopNoticeTimer(): void {
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.noticeTimer = null;
  }

  // Spec 7.3: log in into a new folder, and only once it holds a logged-in account touch the list.
  private async login(intendedEmail: string | null): Promise<void> {
    const runner = this.deps.runner;
    if (!runner || this.disposed || this.loginRunning || this.removing > 0) return;
    const id = this.deps.newId();
    const dir = this.folder(id);
    mkdirSync(dir, { recursive: true });
    const login = startLogin(runner, dir, intendedEmail);
    this.cancelRunningLogin = login.cancel;
    this.loginRunning = true;
    this.setNotice(null);
    this.emit();

    try {
      const result = await login.done;
      this.cancelRunningLogin = null;
      let status = result.code === 0 && !this.disposed ? await readAuthStatus(runner, dir) : null;
      if (status && !status.known && !this.disposed) status = await readAuthStatus(runner, dir); // one more try if nothing was printed
      if (this.disposed || !status?.loggedIn || status.email === null) {
        removeFolder(dir);
        const text = result.timedOut ? LOGIN_FAILED + LOGIN_TIMED_OUT : status && !status.known ? LOGIN_UNCONFIRMED : LOGIN_FAILED;
        this.setNotice(result.aborted ? null : { kind: 'warn', text });
        return;
      }

      const now = this.deps.now().toISOString();
      const merged = reconcileLogin(this.store.accounts, { id, email: status.email, credentialExpiresAt: status.loginExpiresAt, now }, intendedEmail);
      this.store = { ...this.store, accounts: merged.accounts };
      saveStore(this.deps.dataDir, this.store);
      this.setNotice(merged.notice);
      this.emit();

      // The old folders are being logged out and deleted while loginRunning is set, so no refresh or login starts in them.
      await this.readsDone(); // a read may still be running in a folder that is about to go
      for (const oldId of merged.replacedIds) {
        this.cards.delete(oldId);
        if (!this.disposed) await logout(runner, this.folder(oldId)); // after dispose no new process starts
        removeFolder(this.folder(oldId));
      }
    } finally {
      this.cancelRunningLogin = null;
      this.loginRunning = false;
      this.emit();
    }
    if (!this.disposed) await this.read(runner, [id]);
  }

  // Spec 7.2: at most three account reads at a time, plus the default login for the active mark.
  private read(runner: ClaudeRunner, ids: string[]): Promise<void> {
    this.lastStart = this.deps.now().getTime();
    const before = new Map(ids.map((id) => [id, this.cards.get(id)]));
    for (const id of ids) this.cards.set(id, LOADING);
    const queue = [...ids];
    let modelCalled = false; // once one read called the model, no further account is started in this refresh
    const worker = async () => {
      while (!this.disposed && !modelCalled) {
        const id = queue.shift(); // taken only once it will be read, so what is left in the queue was not started
        if (id === undefined) return;
        if (await this.readAccount(runner, id)) modelCalled = true;
      }
    };
    const workers = Array.from({ length: PARALLEL_READS }, worker);
    this.reading = Promise.all([this.readActive(runner), ...workers])
      .then(() => {
        // Accounts left unread go back to what they showed before; a first read that never ran counts as failed.
        for (const id of queue) if (this.find(id)) this.cards.set(id, before.get(id) ?? { status: 'stale', failurePreview: null });
        if (!this.disposed) saveStore(this.deps.dataDir, this.store);
      })
      .finally(() => { this.reading = null; this.emit(); });
    this.emit();
    return this.reading;
  }

  // Returns true when this read called the model.
  private async readAccount(runner: ClaudeRunner, id: string): Promise<boolean> {
    const parse = await readUsage(runner, this.folder(id), () => this.disposed);
    if (this.disposed) return false;
    const modelCalled = parse.kind !== 'unreadable' && parse.modelCalled;
    if (modelCalled) this.autoRefreshPaused = true;
    let card: Card;
    if (parse.kind === 'ok') {
      const fetchedAt = this.deps.now().toISOString();
      this.store = {
        ...this.store,
        accounts: this.store.accounts.map((a) =>
          a.id === id ? { ...a, lines: parse.lines, fetchedAt, credentialExpiresAt: parse.credentialExpiresAt ?? a.credentialExpiresAt } : a),
      };
      card = { status: 'ok', failurePreview: null };
    } else {
      const status = await readAuthStatus(runner, this.folder(id));
      if (this.disposed) return modelCalled;
      // Only a status that says "logged out" asks for a login; one that could not be read keeps the last values.
      card = status.known && !status.loggedIn ? { status: 'login-required', failurePreview: null } : { status: 'stale', failurePreview: parse.preview };
    }
    if (this.find(id)) this.cards.set(id, card);
    this.emit();
    return modelCalled;
  }

  private async readActive(runner: ClaudeRunner): Promise<void> {
    const status = await readAuthStatus(runner, null);
    if (this.disposed) return;
    this.activeEmail = status.loggedIn ? status.email : null;
    this.emit();
  }

  private async readsDone(): Promise<void> {
    // A failed save is reported to the caller of that read, not here.
    while (this.reading) await this.reading.catch(() => {});
  }

  private find(id: string): StoredAccount | undefined {
    return this.store.accounts.find((a) => a.id === id);
  }

  private folder(id: string): string {
    return join(this.deps.dataDir, 'profiles', id);
  }

  private emit(): void {
    if (!this.disposed) this.deps.onChange(this.getState());
  }
}
