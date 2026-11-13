import { dialog, type BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';

// The program's one network request of its own: at start-up it reads the newest release from the GitHub repository
// named in package.json (build.publish), downloads a newer installer in the background, and puts it in place when the
// program closes. Nothing about the accounts is sent. Without a network it logs the error and keeps running.
export function startAutoUpdate(getWindow: () => BrowserWindow | null, logError: (e: unknown) => void): void {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('error', logError);
  autoUpdater.on('update-downloaded', (info) => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return; // closing already: the installer runs on quit
    void dialog.showMessageBox(win, {
      type: 'info',
      message: `새 버전 ${info.version}을 받았습니다.`,
      detail: '지금 다시 시작하면 바로 적용됩니다. [나중에]를 고르면 프로그램을 닫을 때 적용됩니다.',
      buttons: ['지금 다시 시작', '나중에'],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall(true, true);
    }).catch(logError);
  });
  autoUpdater.checkForUpdates().catch(logError);
}
