import { ipcMain, BrowserWindow } from 'electron';
import { registerAccountIpcHandlers } from './account.ipc';

// Window control channels (frameless window)
export function registerWindowIpcHandlers(): void {
  ipcMain.handle('window:minimize', () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) win.minimize();
  });

  ipcMain.handle('window:maximize', () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
    }
  });

  ipcMain.handle('window:close', () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) win.close();
  });

  ipcMain.handle('window:isMaximized', () => {
    const win = BrowserWindow.getFocusedWindow();
    return win ? win.isMaximized() : false;
  });
}

export function registerAllIpcHandlers(): void {
  registerWindowIpcHandlers();
  registerAccountIpcHandlers();
}
