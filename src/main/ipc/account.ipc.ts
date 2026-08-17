import { ipcMain, dialog } from 'electron';
import { getAccountService } from '../services/account.service';
import { getAuthService } from '../services/auth.service';
import { getTraeworkService } from '../services/traework.service';
import { getCheckinService } from '../services/checkin.service';
import { IPC_CHANNELS } from '../../shared/types';
import { logger } from '../utils/logger';
import { store } from '../utils/store';
import type { IpcResponse, Language, LocalAccountInfo, AppSettings } from '../../shared/types';

type AnyResponse = IpcResponse<any>;

// Default app settings
const DEFAULT_SETTINGS: AppSettings = {
  autoCloseTrae: true,
  autoRestartTrae: true,
  traeExePath: '',
};

export function getAppSettings(): AppSettings {
  return {
    autoCloseTrae: store.get('autoCloseTrae', DEFAULT_SETTINGS.autoCloseTrae) as boolean,
    autoRestartTrae: store.get('autoRestartTrae', DEFAULT_SETTINGS.autoRestartTrae) as boolean,
    traeExePath: store.get('traeExePath', DEFAULT_SETTINGS.traeExePath) as string,
  };
}

export function registerAccountIpcHandlers(): void {
  const accountService = getAccountService();
  const authService = getAuthService();
  const traeworkService = getTraeworkService();
  const checkinService = getCheckinService();

  // Get all accounts
  ipcMain.handle(IPC_CHANNELS.ACCOUNT_LIST, async (): Promise<AnyResponse> => {
    try {
      const accounts = accountService.getAllAccounts();
      return { success: true, data: accounts };
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
      return { success: true, data: account };
    } catch (err) {
      logger.error('OAuth add failed:', err);
      return { success: false, error: (err as Error).message };
    }
  });

  // Add account via token
  ipcMain.handle(IPC_CHANNELS.ACCOUNT_ADD_TOKEN, async (_event, { token }: { token: string }): Promise<AnyResponse> => {
    try {
      const account = await accountService.addAccount(token.trim(), 'token_import');
      return { success: true, data: account };
    } catch (err) {
      logger.error('Token add failed:', err);
      return { success: false, error: (err as Error).message };
    }
  });

  // Add/import a specific local account
  ipcMain.handle(IPC_CHANNELS.ACCOUNT_ADD_LOCAL, async (_event, { localInfo }: { localInfo?: LocalAccountInfo } = {}): Promise<AnyResponse> => {
    try {
      let account;
      if (localInfo && localInfo.token) {
        account = await accountService.importLocalAccount(localInfo);
      } else {
        // If no specific localInfo, import all detected local accounts
        const accounts = await accountService.importAllLocalAccounts();
        if (accounts.length === 0) {
          return { success: false, error: '未找到本地登录的 Trae 账号' };
        }
        // Return the first imported account
        account = accounts[0];
      }
      return { success: true, data: account };
    } catch (err) {
      logger.error('Local import failed:', err);
      return { success: false, error: (err as Error).message };
    }
  });

  // Import from JSON file
  ipcMain.handle(IPC_CHANNELS.ACCOUNT_IMPORT_JSON, async (): Promise<AnyResponse> => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'JSON Files', extensions: ['json'] }],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: '未选择文件' };
      }

      const accounts = await accountService.importAccountsFromFile(result.filePaths[0]);
      return { success: true, data: accounts };
    } catch (err) {
      logger.error('JSON import failed:', err);
      return { success: false, error: (err as Error).message };
    }
  });

  // Export accounts to JSON
  ipcMain.handle(IPC_CHANNELS.ACCOUNT_EXPORT, async (_event, { ids }: { ids?: number[] } = {}): Promise<AnyResponse> => {
    try {
      const result = await dialog.showSaveDialog({
        filters: [{ name: 'JSON Files', extensions: ['json'] }],
        defaultPath: `trae-accounts-${new Date().toISOString().split('T')[0]}.json`,
      });

      if (result.canceled || !result.filePath) {
        return { success: false, error: '导出已取消' };
      }

      accountService.exportAccounts(ids, result.filePath);
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
      return { success: true, data: account };
    } catch (err) {
      logger.error('Switch failed:', err);
      return { success: false, error: (err as Error).message };
    }
  });

  // Refresh single account
  ipcMain.handle(IPC_CHANNELS.ACCOUNT_REFRESH, async (_event, { id }: { id: number }): Promise<AnyResponse> => {
    try {
      const account = await accountService.refreshAccount(id);
      return { success: true, data: account };
    } catch (err) {
      logger.error('Refresh failed:', err);
      return { success: false, error: (err as Error).message };
    }
  });

  // Refresh all accounts
  ipcMain.handle(IPC_CHANNELS.ACCOUNT_REFRESH_ALL, async (): Promise<AnyResponse> => {
    try {
      const accounts = await accountService.refreshAllAccounts();
      return { success: true, data: accounts };
    } catch (err) {
      logger.error('Refresh all failed:', err);
      return { success: false, error: (err as Error).message };
    }
  });

  // Single checkin
  ipcMain.handle(IPC_CHANNELS.CHECKIN_SINGLE, async (_event, { id }: { id: number }): Promise<AnyResponse> => {
    try {
      const result = await checkinService.checkinSingle(id);
      return { success: result.success, data: result };
    } catch (err) {
      logger.error('Checkin failed:', err);
      return { success: false, error: (err as Error).message };
    }
  });

  // Batch checkin
  ipcMain.handle(IPC_CHANNELS.CHECKIN_BATCH, async (_event, { ids }: { ids: number[] }): Promise<AnyResponse> => {
    try {
      const result = await checkinService.checkinBatch(ids);
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
      return { success: true, data: accounts.length > 0 ? accounts[0] : { exists: false } };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // Detect all local accounts
  ipcMain.handle(IPC_CHANNELS.STORAGE_DETECT_ALL_LOCAL, async (): Promise<AnyResponse> => {
    try {
      const accounts = traeworkService.detectLocalAccounts();
      return { success: true, data: accounts };
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
}
