import { contextBridge, ipcRenderer } from 'electron';
import type { AppState } from '../core/types';

const api = {
  getState: (): Promise<AppState | null> => ipcRenderer.invoke('state:get'),
  onState: (listener: (s: AppState) => void): void => {
    ipcRenderer.on('state:changed', (_e, s: AppState) => listener(s));
  },
  refresh: (): void => ipcRenderer.send('action:refresh'),
  addAccount: (): void => ipcRenderer.send('action:add-account'),
  relogin: (id: string): void => ipcRenderer.send('action:relogin', id),
  cancelLogin: (): void => ipcRenderer.send('action:cancel-login'),
  removeAccount: (id: string): void => ipcRenderer.send('action:remove-account', id),
  moveAccount: (id: string, toIndex: number): void => ipcRenderer.send('action:move-account', id, toIndex),
  cycleMascot: (): void => ipcRenderer.send('action:cycle-mascot'),
  setAutoRefresh: (on: boolean): void => ipcRenderer.send('action:set-auto-refresh', on),
  pickClaudePath: (): void => ipcRenderer.send('action:pick-claude-path'),
  retryFindClaude: (): void => ipcRenderer.send('action:retry-find-claude'),
  // Tells the main process a settled state is on screen; only the smoke capture listens.
  reportPainted: (): void => ipcRenderer.send('ui:painted'),
};

export type Api = typeof api;

contextBridge.exposeInMainWorld('api', api);
