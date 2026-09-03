import { app, BrowserWindow } from 'electron';
import { createMainWindow, getMainWindow } from './window';
import { createTray, destroyTray } from './tray';
import { initDatabase, closeDatabase } from './services/database';
import { registerAllIpcHandlers } from './ipc';
import { ensureDirectories } from './utils/paths';
import { getAccountService } from './services/account.service';
import { getDeviceService } from './services/device.service';
import { getAutoCheckinService } from './services/auto-checkin.service';
import { getUpdateService } from './services/update.service';
import { IPC_CHANNELS } from '../shared/types';
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
      getDeviceService().scanAndSyncLocalDevices();
      logger.info('Device pool sync finished on startup.');
    } catch (err) {
      logger.error('[DIAG] Database init or device sync failed:', (err as Error).message);
    }

    // Clear refresh tokens cross-contaminated by older builds BEFORE recovery
    // rewrites rows: while two rows still carry the same foreign refresh token
    // the conflict is visible and both get cleaned; after recovery heals one
    // row the other's copy would look legitimately owned and survive.
    try {
      getAccountService().repairForeignRefreshTokens();
    } catch (err) {
      logger.warn('Refresh-token repair failed:', (err as Error).message);
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

    // Start the auto check-in scheduler (no-op when disabled)
    try {
      getAutoCheckinService().reschedule();
    } catch (err) {
      logger.warn('Auto check-in scheduler start failed:', (err as Error).message);
    }

    // Create main window
    createMainWindow();

    // Create system tray (always-on-resident). The tray provides an explicit
    // "Quit" entry so the user still has a clean shutdown path even though
    // window-all-closed no longer terminates the process.
    createTray({ getMainWindow, createMainWindow });

    // Silent startup update check. On machines that cannot reach GitHub the
    // jsDelivr mirror fallback still runs; failures are logged only. When a
    // newer version is found, push it to the renderer for a toast.
    setTimeout(() => {
      void getUpdateService().checkForUpdates().then((info) => {
        if (!info.updateAvailable) return;
        logger.info(`Startup update check: v${info.latestVersion} is available`);
        const win = getMainWindow();
        if (win && !win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.APP_UPDATE_AVAILABLE, {
            latestVersion: info.latestVersion,
            releaseUrl: info.releaseUrl,
          });
        }
      }).catch((err) => {
        logger.warn('Startup update check failed:', (err as Error).message);
      });
    }, 8000);

    // macOS: re-create window when dock icon clicked
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  });

  // Tray-resident app: closing the last window no longer terminates the
  // process. The user can restore the window from the tray, or pick "Quit"
  // in the tray menu to actually exit.
  app.on('window-all-closed', () => {
    logger.warn('[DIAG] window-all-closed fired (kept alive via tray)');
  });

  app.on('before-quit', () => {
    logger.warn('[DIAG] before-quit fired');
    destroyTray();
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
