import { ipcMain, dialog, app, BrowserWindow } from 'electron';
import { getAccountService } from '../services/account.service';
import { getAuthService } from '../services/auth.service';
import { getTraeworkService } from '../services/traework.service';
import { getDeviceService } from '../services/device.service';
import { getCheckinService } from '../services/checkin.service';
import { getUpdateService } from '../services/update.service';
import { getAutoCheckinService } from '../services/auto-checkin.service';
import { IPC_CHANNELS } from '../../shared/types';
import { logger } from '../utils/logger';
import { store } from '../utils/store';
import type { Account, AccountView, IpcResponse, Language, LocalAccountInfo, LocalAccountView, AppSettings } from '../../shared/types';

type AnyResponse = IpcResponse<any>;

function toAccountView(account: Account): AccountView {
  const { token: _token, refreshToken, ...safe } = account;
  return { ...safe, hasRefreshToken: !!refreshToken };
}

function toLocalAccountView(account: LocalAccountInfo): LocalAccountView {
  const { token: _token, refreshToken: _refreshToken, authBlob: _authBlob, ...safe } = account;
  return safe;
}

// Default app settings
const DEFAULT_SETTINGS: AppSettings = {
  autoCloseTrae: true,
  autoRestartTrae: true,
  traeExePath: '',
  autoCheckinEnabled: false,
  autoCheckinStart: '06:00',
  autoCheckinEnd: '12:00',
};

export function getAppSettings(): AppSettings {
  return {
    autoCloseTrae: store.get('autoCloseTrae', DEFAULT_SETTINGS.autoCloseTrae) as boolean,
    autoRestartTrae: store.get('autoRestartTrae', DEFAULT_SETTINGS.autoRestartTrae) as boolean,
    traeExePath: store.get('traeExePath', DEFAULT_SETTINGS.traeExePath) as string,
    autoCheckinEnabled: store.get('autoCheckinEnabled', DEFAULT_SETTINGS.autoCheckinEnabled) as boolean,
    autoCheckinStart: store.get('autoCheckinStart', DEFAULT_SETTINGS.autoCheckinStart) as string,
    autoCheckinEnd: store.get('autoCheckinEnd', DEFAULT_SETTINGS.autoCheckinEnd) as string,
  };
}

export function registerAccountIpcHandlers(): void {
  const accountService = getAccountService();
  const authService = getAuthService();
  const traeworkService = getTraeworkService();
  const checkinService = getCheckinService();
  const updateService = getUpdateService();

  // Get all accounts
  ipcMain.handle(IPC_CHANNELS.ACCOUNT_LIST, async (): Promise<AnyResponse> => {
    try {
      const accounts = accountService.getAllAccounts();
      return { success: true, data: accounts.map(toAccountView) };
    } catch (err) {
      logger.error('Failed to get accounts:', err);
      return { success: false, error: (err as Error).message };
    }
  });

  // Add account via OAuth
  ipcMain.handle(IPC_CHANNELS.ACCOUNT_ADD_OAUTH, async (): Promise<AnyResponse> => {
    try {
      const authResult = await authService.startOAuth();
      const account = await accountService.addAccountFromOAuth(
        authResult.token,
        authResult.host,
        authResult.refreshToken,
        authResult.expiredAt
      );
      return { success: true, data: toAccountView(account) };
    } catch (err) {
      logger.error('OAuth add failed:', err);
      return { success: false, error: (err as Error).message };
    }
  });

  // Add account via token
  ipcMain.handle(IPC_CHANNELS.ACCOUNT_ADD_TOKEN, async (_event, { token }: { token: string }): Promise<AnyResponse> => {
    try {
      const account = await accountService.addAccount(token.trim(), 'token_import');
      return { success: true, data: toAccountView(account) };
    } catch (err) {
      logger.error('Token add failed:', err);
      return { success: false, error: (err as Error).message };
    }
  });

  // Add/import a specific local account
  ipcMain.handle(IPC_CHANNELS.ACCOUNT_ADD_LOCAL, async (_event, { localInfo }: { localInfo?: LocalAccountView } = {}): Promise<AnyResponse> => {
    try {
      let account;
      if (localInfo) {
        // Re-read credentials in the trusted main process. Tokens and auth
        // blobs never need to cross into the renderer merely for selection.
        const detected = traeworkService.detectLocalAccounts().find(candidate =>
          candidate.storagePath === localInfo.storagePath &&
          (!localInfo.userId || candidate.userId === localInfo.userId)
        );
        if (!detected) throw new Error('所选本地账号已失效，请重新检测');
        account = await accountService.importLocalAccount(detected);
      } else {
        // If no specific localInfo, import all detected local accounts
        const accounts = await accountService.importAllLocalAccounts();
        if (accounts.length === 0) {
          return { success: false, error: '未找到本地登录的 Trae 账号' };
        }
        // Return the first imported account
        account = accounts[0];
      }
      return { success: true, data: toAccountView(account) };
    } catch (err) {
      logger.error('Local import failed:', err);
      return { success: false, error: (err as Error).message };
    }
  });

  // Import from JSON file
  ipcMain.handle(IPC_CHANNELS.ACCOUNT_IMPORT_JSON, async (_event, { password }: { password?: string } = {}): Promise<AnyResponse> => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'JSON Files', extensions: ['json'] }],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: 'CANCELLED' };
      }

      const accounts = await accountService.importAccountsFromFile(result.filePaths[0], password);
      return { success: true, data: accounts.map(toAccountView) };
    } catch (err) {
      logger.error('JSON import failed:', err);
      return { success: false, error: (err as Error).message };
    }
  });

  // Export accounts to JSON
  ipcMain.handle(IPC_CHANNELS.ACCOUNT_EXPORT, async (_event, { ids, password }: { ids?: number[]; password?: string } = {}): Promise<AnyResponse> => {
    try {
      const result = await dialog.showSaveDialog({
        filters: [{ name: 'JSON Files', extensions: ['json'] }],
        defaultPath: `trae-accounts-${new Date().toISOString().split('T')[0]}.json`,
      });

      if (result.canceled || !result.filePath) {
        return { success: false, error: 'CANCELLED' };
      }

      accountService.exportAccounts(ids, result.filePath, password);
      return { success: true, data: { filePath: result.filePath } };
    } catch (err) {
      logger.error('Export failed:', err);
      return { success: false, error: (err as Error).message };
    }
  });

  // Delete account
  ipcMain.handle(IPC_CHANNELS.ACCOUNT_DELETE, async (_event, { id }: { id: number }): Promise<AnyResponse> => {
    try {
      accountService.deleteAccount(id);
      return { success: true };
    } catch (err) {
      logger.error('Delete failed:', err);
      return { success: false, error: (err as Error).message };
    }
  });

  // Switch account
  ipcMain.handle(IPC_CHANNELS.ACCOUNT_SWITCH, async (_event, { id, storagePath, autoCloseTrae, autoRestartTrae, traeExePath }: { id: number; storagePath?: string; autoCloseTrae?: boolean; autoRestartTrae?: boolean; traeExePath?: string }): Promise<AnyResponse> => {
    try {
      const account = await accountService.switchToAccount(id, storagePath, {
        autoCloseTrae,
        autoRestartTrae,
        traeExePath,
      });
      return { success: true, data: toAccountView(account) };
    } catch (err) {
      logger.error('Switch failed:', err);
      return { success: false, error: (err as Error).message };
    }
  });

  // Refresh single account
  ipcMain.handle(IPC_CHANNELS.ACCOUNT_REFRESH, async (_event, { id }: { id: number }): Promise<AnyResponse> => {
    try {
      const account = await accountService.refreshAccount(id);
      return { success: true, data: toAccountView(account) };
    } catch (err) {
      logger.error('Refresh failed:', err);
      return { success: false, error: (err as Error).message };
    }
  });

  // Refresh all accounts
  ipcMain.handle(IPC_CHANNELS.ACCOUNT_REFRESH_ALL, async (): Promise<AnyResponse> => {
    try {
      const accounts = await accountService.refreshAllAccounts();
      return { success: true, data: accounts.map(toAccountView) };
    } catch (err) {
      logger.error('Refresh all failed:', err);
      return { success: false, error: (err as Error).message };
    }
  });

  // Single checkin
  ipcMain.handle(IPC_CHANNELS.CHECKIN_SINGLE, async (_event, { id }: { id: number }): Promise<AnyResponse> => {
    try {
      const result = await checkinService.checkinSingle(id);
      broadcastDevicesUpdated();
      // IPC succeeded even when the server rejected the check-in. Keep the
      // domain result in data so the renderer can show the precise reason
      // (for example device-scoped code 9095) instead of a generic error.
      return { success: true, data: result };
    } catch (err) {
      logger.error('Checkin failed:', err);
      return { success: false, error: (err as Error).message };
    }
  });

  // Batch checkin
  ipcMain.handle(IPC_CHANNELS.CHECKIN_BATCH, async (_event, { ids }: { ids: number[] }): Promise<AnyResponse> => {
    try {
      const result = await checkinService.checkinBatch(ids);
      broadcastDevicesUpdated();
      return { success: true, data: result };
    } catch (err) {
      logger.error('Batch checkin failed:', err);
      return { success: false, error: (err as Error).message };
    }
  });

  // Usage records
  ipcMain.handle(IPC_CHANNELS.USAGE_RECORDS, async (_event, { id, startTime, endTime, pageSize, pageNum }: { id: number; startTime?: number; endTime?: number; pageSize?: number; pageNum?: number }): Promise<AnyResponse> => {
    try {
      const result = await accountService.getUsageRecords(id, { startTime, endTime, pageSize, pageNum });
      return { success: true, data: result };
    } catch (err) {
      logger.error('Get usage records failed:', err);
      return { success: false, error: (err as Error).message };
    }
  });

  // Detect local account (returns first found)
  ipcMain.handle(IPC_CHANNELS.STORAGE_DETECT_LOCAL, async (): Promise<AnyResponse> => {
    try {
      const accounts = traeworkService.detectLocalAccounts();
      return { success: true, data: accounts.length > 0 ? toLocalAccountView(accounts[0]) : { exists: false } };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // Detect all local accounts
  ipcMain.handle(IPC_CHANNELS.STORAGE_DETECT_ALL_LOCAL, async (): Promise<AnyResponse> => {
    try {
      const accounts = traeworkService.detectLocalAccounts();
      return { success: true, data: accounts.map(toLocalAccountView) };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // Check if Traework is running
  ipcMain.handle(IPC_CHANNELS.APP_CHECK_TRAEWORK_RUNNING, async (): Promise<AnyResponse> => {
    try {
      const running = await traeworkService.isTraeworkRunning();
      return { success: true, data: { running } };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // Get language setting
  ipcMain.handle(IPC_CHANNELS.APP_GET_LANGUAGE, async (): Promise<AnyResponse> => {
    try {
      const language = store.get('language', 'zh') as Language;
      return { success: true, data: { language } };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // Set language
  ipcMain.handle(IPC_CHANNELS.APP_SET_LANGUAGE, async (_event, { language }: { language: Language }): Promise<AnyResponse> => {
    try {
      store.set('language', language);
      return { success: true, data: { language } };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // Get app settings
  ipcMain.handle(IPC_CHANNELS.APP_GET_SETTINGS, async (): Promise<AnyResponse> => {
    try {
      return { success: true, data: getAppSettings() };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // Set app settings
  ipcMain.handle(IPC_CHANNELS.APP_SET_SETTINGS, async (_event, { settings }: { settings: Partial<AppSettings> }): Promise<AnyResponse> => {
    try {
      if (typeof settings.autoCloseTrae === 'boolean') store.set('autoCloseTrae', settings.autoCloseTrae);
      if (typeof settings.autoRestartTrae === 'boolean') store.set('autoRestartTrae', settings.autoRestartTrae);
      if (typeof settings.traeExePath === 'string') store.set('traeExePath', settings.traeExePath);
      return { success: true, data: getAppSettings() };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // Auto check-in: live scheduler state
  ipcMain.handle(IPC_CHANNELS.AUTOCHECKIN_GET_STATUS, async (): Promise<AnyResponse> => {
    try {
      return { success: true, data: getAutoCheckinService().getStatus() };
    } catch (err) {
      logger.error('Get auto-checkin status failed:', err);
      return { success: false, error: (err as Error).message };
    }
  });

  // Auto check-in: update settings (enable/disable, time window) and reschedule
  ipcMain.handle(IPC_CHANNELS.AUTOCHECKIN_SET_SETTINGS, async (_event, { enabled, start, end }: { enabled?: boolean; start?: string; end?: string }): Promise<AnyResponse> => {
    try {
      const service = getAutoCheckinService();
      const settings = service.updateSettings({ enabled, start, end });
      return { success: true, data: { settings, status: service.getStatus() } };
    } catch (err) {
      logger.error('Set auto-checkin settings failed:', err);
      return { success: false, error: (err as Error).message };
    }
  });

  // Auto check-in: run immediately once (recorded as a manual test run)
  ipcMain.handle(IPC_CHANNELS.AUTOCHECKIN_RUN_TEST, async (): Promise<AnyResponse> => {
    try {
      const record = await getAutoCheckinService().runTest();
      return { success: true, data: record };
    } catch (err) {
      logger.error('Auto-checkin test run failed:', err);
      return { success: false, error: (err as Error).message };
    }
  });

  // Auto check-in: execution history (30-day rolling)
  ipcMain.handle(IPC_CHANNELS.AUTOCHECKIN_GET_RECORDS, async (): Promise<AnyResponse> => {
    try {
      return { success: true, data: getAutoCheckinService().getRecords() };
    } catch (err) {
      logger.error('Get auto-checkin records failed:', err);
      return { success: false, error: (err as Error).message };
    }
  });

  // Auto check-in: wipe execution history
  ipcMain.handle(IPC_CHANNELS.AUTOCHECKIN_CLEAR_RECORDS, async (): Promise<AnyResponse> => {
    try {
      getAutoCheckinService().clearRecords();
      return { success: true };
    } catch (err) {
      logger.error('Clear auto-checkin records failed:', err);
      return { success: false, error: (err as Error).message };
    }
  });

  // Detect Trae executable path
  ipcMain.handle(IPC_CHANNELS.APP_DETECT_TRAE_EXE, async (): Promise<AnyResponse> => {
    try {
      const exePath = await traeworkService.findTraeExePath();
      return { success: true, data: { exePath } };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // Close Trae (auto-close for switching)
  ipcMain.handle(IPC_CHANNELS.APP_CLOSE_TRAEWORK, async (): Promise<AnyResponse> => {
    try {
      const killed = await traeworkService.closeTraework();
      return { success: true, data: { killed } };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // Launch Trae
  ipcMain.handle(IPC_CHANNELS.APP_LAUNCH_TRAEWORK, async (_event, { exePath }: { exePath?: string } = {}): Promise<AnyResponse> => {
    try {
      const launched = await traeworkService.launchTraework(exePath);
      return { success: true, data: { launched } };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // Get app version
  ipcMain.handle(IPC_CHANNELS.APP_GET_VERSION, (): AnyResponse => {
    return { success: true, data: { version: app.getVersion() } };
  });

  // Check for updates against GitHub Releases
  ipcMain.handle(IPC_CHANNELS.APP_CHECK_UPDATE, async (): Promise<AnyResponse> => {
    try {
      const info = await updateService.checkForUpdates();
      return { success: true, data: info };
    } catch (err) {
      logger.error('Update check failed:', err);
      return { success: false, error: (err as Error).message };
    }
  });

  // Download update installer (progress via UPDATE_DOWNLOAD_PROGRESS events)
  ipcMain.handle(IPC_CHANNELS.APP_DOWNLOAD_UPDATE, async (_event, { url, name }: { url: string; name: string }): Promise<AnyResponse> => {
    try {
      const installerPath = await updateService.downloadUpdate(url, name);
      return { success: true, data: { installerPath } };
    } catch (err) {
      logger.error('Update download failed:', err);
      return { success: false, error: (err as Error).message };
    }
  });

  // Run downloaded installer and quit the app
  ipcMain.handle(IPC_CHANNELS.APP_INSTALL_UPDATE, async (_event, { installerPath }: { installerPath: string }): Promise<AnyResponse> => {
    try {
      const launched = await updateService.installUpdate(installerPath);
      return { success: true, data: { launched } };
    } catch (err) {
      logger.error('Update install failed:', err);
      return { success: false, error: (err as Error).message };
    }
  });

  // Open a GitHub release page in the default browser (only github.com URLs)
  ipcMain.handle(IPC_CHANNELS.APP_OPEN_RELEASE_PAGE, async (_event, { url }: { url: string }): Promise<AnyResponse> => {
    try {
      if (!/^https:\/\/github\.com\//.test(url)) {
        throw new Error('仅允许打开 GitHub 链接');
      }
      updateService.openReleasePage(url);
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  const deviceService = getDeviceService();

  function broadcastDevicesUpdated(): void {
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        win.webContents.send(IPC_CHANNELS.DEVICES_UPDATED);
      } catch {
        // 忽略已销毁的窗口
      }
    }
  }

  // Get all devices
  ipcMain.handle(IPC_CHANNELS.DEVICE_LIST, async (): Promise<AnyResponse> => {
    try {
      const devices = deviceService.getAllDevices();
      return { success: true, data: devices };
    } catch (err) {
      logger.error('Failed to get devices:', err);
      return { success: false, error: (err as Error).message };
    }
  });

  // Add external device
  ipcMain.handle(IPC_CHANNELS.DEVICE_ADD, async (_event, { deviceId, label }: { deviceId: string; label?: string }): Promise<AnyResponse> => {
    try {
      const device = deviceService.addDevice(deviceId, label);
      broadcastDevicesUpdated();
      return { success: true, data: device };
    } catch (err) {
      logger.error('Failed to add device:', err);
      return { success: false, error: (err as Error).message };
    }
  });

  // Update device label
  ipcMain.handle(IPC_CHANNELS.DEVICE_UPDATE, async (_event, { id, label }: { id: number; label: string }): Promise<AnyResponse> => {
    try {
      const device = deviceService.updateDevice(id, label);
      broadcastDevicesUpdated();
      return { success: true, data: device };
    } catch (err) {
      logger.error('Failed to update device:', err);
      return { success: false, error: (err as Error).message };
    }
  });

  // Delete external device
  ipcMain.handle(IPC_CHANNELS.DEVICE_DELETE, async (_event, { id }: { id: number }): Promise<AnyResponse> => {
    try {
      deviceService.deleteDevice(id);
      broadcastDevicesUpdated();
      for (const win of BrowserWindow.getAllWindows()) {
        try {
          win.webContents.send(IPC_CHANNELS.ACCOUNTS_UPDATED);
        } catch {
          // 忽略已销毁的窗口
        }
      }
      return { success: true };
    } catch (err) {
      logger.error('Failed to delete device:', err);
      return { success: false, error: (err as Error).message };
    }
  });

  // Scan and sync local devices
  ipcMain.handle(IPC_CHANNELS.DEVICE_SCAN_LOCAL, async (): Promise<AnyResponse> => {
    try {
      const devices = deviceService.scanAndSyncLocalDevices();
      broadcastDevicesUpdated();
      return { success: true, data: devices };
    } catch (err) {
      logger.error('Failed to scan local devices:', err);
      return { success: false, error: (err as Error).message };
    }
  });

  // Test device
  ipcMain.handle(IPC_CHANNELS.DEVICE_TEST, async (_event, { deviceId }: { deviceId: string }): Promise<AnyResponse> => {
    try {
      const result = deviceService.testDevice(deviceId);
      return { success: true, data: result };
    } catch (err) {
      logger.error('Device test failed:', err);
      return { success: false, error: (err as Error).message };
    }
  });

  // Set account bound device
  ipcMain.handle(IPC_CHANNELS.ACCOUNT_SET_BOUND_DEVICE, async (_event, { accountId, boundDeviceId }: { accountId: number; boundDeviceId: string | null }): Promise<AnyResponse> => {
    try {
      const updated = accountService.setBoundDevice(accountId, boundDeviceId);
      for (const win of BrowserWindow.getAllWindows()) {
        try {
          win.webContents.send(IPC_CHANNELS.ACCOUNTS_UPDATED, { accountId });
        } catch {
          // 忽略已销毁的窗口
        }
      }
      return { success: true, data: toAccountView(updated) };
    } catch (err) {
      logger.error('Failed to set bound device:', err);
      return { success: false, error: (err as Error).message };
    }
  });
}
