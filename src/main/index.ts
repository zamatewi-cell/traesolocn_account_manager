import { app, BrowserWindow } from 'electron';
import { createMainWindow, getMainWindow } from './window';
import { initDatabase, closeDatabase } from './services/database';
import { registerAllIpcHandlers } from './ipc';
import { ensureDirectories } from './utils/paths';
import { getAccountService } from './services/account.service';
import { logger } from './utils/logger';

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    logger.info('[DIAG] second-instance fired, focusing existing window');
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.setAlwaysOnTop(true, 'screen-saver');
      win.moveTop();
      win.focus();
      setTimeout(() => {
        if (!win.isDestroyed()) win.setAlwaysOnTop(false);
      }, 1000);
    } else {
      // Window was closed but process is still alive: recreate it
      logger.warn('[DIAG] second-instance but no window, recreating');
      createMainWindow();
    }
  });

  // App ready
  app.whenReady().then(() => {
    logger.info('App starting...');
    logger.info('App version:', app.getVersion());
    logger.info('Electron version:', process.versions.electron);
    logger.info('Node version:', process.versions.node);

    // Ensure directories exist
    ensureDirectories();

    // Initialize database. Wrap in try/catch so a DB failure (e.g. native module
    // not unpacked from ASAR) never prevents the main window from being created.
    try {
      initDatabase();
    } catch (err) {
      logger.error('[DIAG] Database init failed (continuing without DB):', (err as Error).message);
    }

    // Recover accounts from local Trae storage (fixes tokens written by older builds
    // with a different encryption format, and refreshes expired tokens)
    getAccountService().recoverAccountsFromLocal().then(async (accounts) => {
      logger.info(`Account recovery finished. ${accounts.length} account(s) available.`);
      // Harvest credentials the local Trae client refreshed on its own while it
      // ran: rows holding a dead OAuth web token adopt the live client token +
      // refresh token, so switches never write expired credentials again.
      try {
        getAccountService().harvestLiveCredentials();
      } catch (err) {
        logger.warn('Credential harvest failed:', (err as Error).message);
      }
      // Auto-refresh all accounts so avatar / credits / checkin data is fresh on open
      try {
        await getAccountService().refreshAllAccounts();
        logger.info('Auto-refresh of all accounts finished.');
      } catch (err) {
        logger.warn('Auto-refresh failed:', (err as Error).message);
      }
    }).catch((err) => {
      logger.warn('Account recovery failed:', (err as Error).message);
    });

    // Register IPC handlers
    registerAllIpcHandlers();

    // Create main window
    createMainWindow();

    // macOS: re-create window when dock icon clicked
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  });

  // Windows/Linux: quit when all windows closed
  app.on('window-all-closed', () => {
    logger.warn('[DIAG] window-all-closed fired');
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', () => {
    logger.warn('[DIAG] before-quit fired');
    closeDatabase();
    logger.info('App quitting...');
  });

  // Diagnostics: log renderer/gpu crashes and unexpected exits
  app.on('render-process-gone', (_event, webContents, details) => {
    logger.error('[DIAG] render-process-gone:', details.reason, details.exitCode);
  });
  app.on('child-process-gone', (_event, details) => {
    logger.error('[DIAG] child-process-gone:', details.type, details.reason, details.exitCode);
  });
  process.on('uncaughtException', (err) => {
    logger.error('[DIAG] uncaughtException:', err);
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('[DIAG] unhandledRejection:', reason);
  });

  // Security: prevent new window creation
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => {
      return { action: 'deny' };
    });
  });
}
