import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/types';
import type { Account, CheckinResult, BatchCheckinResult, LocalAccountInfo, IpcResponse, Language, AppSettings, UsageRecord, UpdateInfo, UpdateProgress, AutoCheckinStatus, AutoCheckinRecord } from '../shared/types';

// Wrapper function for IPC calls with proper typing
async function ipcInvoke<T = unknown>(channel: string, ...args: unknown[]): Promise<IpcResponse<T>> {
  try {
    return await ipcRenderer.invoke(channel, ...args);
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

const electronAPI = {
  // Window controls
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized'),
  },

  // Account operations
  accounts: {
    list: (): Promise<IpcResponse<Account[]>> => ipcInvoke<Account[]>(IPC_CHANNELS.ACCOUNT_LIST),
    addByOAuth: (): Promise<IpcResponse<Account>> => ipcInvoke<Account>(IPC_CHANNELS.ACCOUNT_ADD_OAUTH),
    addByToken: (token: string): Promise<IpcResponse<Account>> => 
      ipcInvoke<Account>(IPC_CHANNELS.ACCOUNT_ADD_TOKEN, { token }),
    addFromLocal: (localInfo?: LocalAccountInfo): Promise<IpcResponse<Account>> => 
      ipcInvoke<Account>(IPC_CHANNELS.ACCOUNT_ADD_LOCAL, { localInfo }),
    importFromJson: (): Promise<IpcResponse<Account[]>> => ipcInvoke<Account[]>(IPC_CHANNELS.ACCOUNT_IMPORT_JSON),
    export: (ids?: number[]): Promise<IpcResponse<{ filePath: string }>> => 
      ipcInvoke<{ filePath: string }>(IPC_CHANNELS.ACCOUNT_EXPORT, { ids }),
    delete: (id: number): Promise<IpcResponse> => ipcInvoke(IPC_CHANNELS.ACCOUNT_DELETE, { id }),
    switch: (id: number, options?: { autoCloseTrae?: boolean; autoRestartTrae?: boolean; traeExePath?: string }): Promise<IpcResponse<Account>> => 
      ipcInvoke<Account>(IPC_CHANNELS.ACCOUNT_SWITCH, { id, ...options }),
    refresh: (id: number): Promise<IpcResponse<Account>> => ipcInvoke<Account>(IPC_CHANNELS.ACCOUNT_REFRESH, { id }),
    refreshAll: (): Promise<IpcResponse<Account[]>> => ipcInvoke<Account[]>(IPC_CHANNELS.ACCOUNT_REFRESH_ALL),
    onAccountsUpdated: (callback: () => void): (() => void) => {
      const listener = () => callback();
      ipcRenderer.on(IPC_CHANNELS.ACCOUNTS_UPDATED, listener);
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.ACCOUNTS_UPDATED, listener);
      };
    },
  },

  // Checkin operations
  checkin: {
    single: (id: number): Promise<IpcResponse<CheckinResult>> => 
      ipcInvoke<CheckinResult>(IPC_CHANNELS.CHECKIN_SINGLE, { id }),
    batch: (ids: number[]): Promise<IpcResponse<BatchCheckinResult>> => 
      ipcInvoke<BatchCheckinResult>(IPC_CHANNELS.CHECKIN_BATCH, { ids }),
  },

  // Usage records
  usage: {
    records: (id: number, options?: { startTime?: number; endTime?: number; pageSize?: number; pageNum?: number }): Promise<IpcResponse<{ total: number; records: UsageRecord[] }>> => 
      ipcInvoke<{ total: number; records: UsageRecord[] }>(IPC_CHANNELS.USAGE_RECORDS, { id, ...options }),
  },

  // Storage/app operations
  storage: {
    detectLocalAccount: (): Promise<IpcResponse<LocalAccountInfo>> => 
      ipcInvoke<LocalAccountInfo>(IPC_CHANNELS.STORAGE_DETECT_LOCAL),
    detectAllLocalAccounts: (): Promise<IpcResponse<LocalAccountInfo[]>> => 
      ipcInvoke<LocalAccountInfo[]>(IPC_CHANNELS.STORAGE_DETECT_ALL_LOCAL),
    isTraeworkRunning: (): Promise<IpcResponse<{ running: boolean }>> => 
      ipcInvoke<{ running: boolean }>(IPC_CHANNELS.APP_CHECK_TRAEWORK_RUNNING),
  },

  // Auto check-in
  autoCheckin: {
    getStatus: (): Promise<IpcResponse<AutoCheckinStatus>> =>
      ipcInvoke<AutoCheckinStatus>(IPC_CHANNELS.AUTOCHECKIN_GET_STATUS),
    setSettings: (settings: { enabled?: boolean; start?: string; end?: string }): Promise<IpcResponse<{ settings: { enabled: boolean; start: string; end: string }; status: AutoCheckinStatus }>> =>
      ipcInvoke<{ settings: { enabled: boolean; start: string; end: string }; status: AutoCheckinStatus }>(IPC_CHANNELS.AUTOCHECKIN_SET_SETTINGS, settings),
    runTest: (): Promise<IpcResponse<AutoCheckinRecord>> =>
      ipcInvoke<AutoCheckinRecord>(IPC_CHANNELS.AUTOCHECKIN_RUN_TEST),
    getRecords: (): Promise<IpcResponse<AutoCheckinRecord[]>> =>
      ipcInvoke<AutoCheckinRecord[]>(IPC_CHANNELS.AUTOCHECKIN_GET_RECORDS),
    clearRecords: (): Promise<IpcResponse> =>
      ipcInvoke(IPC_CHANNELS.AUTOCHECKIN_CLEAR_RECORDS),
    onCompleted: (callback: (record: AutoCheckinRecord) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, record: AutoCheckinRecord) => callback(record);
      ipcRenderer.on(IPC_CHANNELS.AUTOCHECKIN_COMPLETED, listener);
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.AUTOCHECKIN_COMPLETED, listener);
      };
    },
  },

  // App settings
  app: {
    getLanguage: (): Promise<IpcResponse<{ language: Language }>> => 
      ipcInvoke<{ language: Language }>(IPC_CHANNELS.APP_GET_LANGUAGE),
    setLanguage: (language: Language): Promise<IpcResponse<{ language: Language }>> => 
      ipcInvoke<{ language: Language }>(IPC_CHANNELS.APP_SET_LANGUAGE, { language }),
    getSettings: (): Promise<IpcResponse<AppSettings>> => 
      ipcInvoke<AppSettings>(IPC_CHANNELS.APP_GET_SETTINGS),
    setSettings: (settings: Partial<AppSettings>): Promise<IpcResponse<AppSettings>> => 
      ipcInvoke<AppSettings>(IPC_CHANNELS.APP_SET_SETTINGS, { settings }),
    detectTraeExe: (): Promise<IpcResponse<{ exePath: string | null }>> =>
      ipcInvoke<{ exePath: string | null }>(IPC_CHANNELS.APP_DETECT_TRAE_EXE),
    closeTraework: (): Promise<IpcResponse<{ killed: number }>> =>
      ipcInvoke<{ killed: number }>(IPC_CHANNELS.APP_CLOSE_TRAEWORK),
    launchTraework: (exePath?: string): Promise<IpcResponse<{ launched: string | null }>> =>
      ipcInvoke<{ launched: string | null }>(IPC_CHANNELS.APP_LAUNCH_TRAEWORK, { exePath }),
    getVersion: (): Promise<IpcResponse<{ version: string }>> =>
      ipcInvoke<{ version: string }>(IPC_CHANNELS.APP_GET_VERSION),
    checkForUpdate: (): Promise<IpcResponse<UpdateInfo>> =>
      ipcInvoke<UpdateInfo>(IPC_CHANNELS.APP_CHECK_UPDATE),
    downloadUpdate: (url: string, name: string): Promise<IpcResponse<{ installerPath: string }>> =>
      ipcInvoke<{ installerPath: string }>(IPC_CHANNELS.APP_DOWNLOAD_UPDATE, { url, name }),
    installUpdate: (installerPath: string): Promise<IpcResponse<{ launched: boolean }>> =>
      ipcInvoke<{ launched: boolean }>(IPC_CHANNELS.APP_INSTALL_UPDATE, { installerPath }),
    openReleasePage: (url: string): Promise<IpcResponse> =>
      ipcInvoke(IPC_CHANNELS.APP_OPEN_RELEASE_PAGE, { url }),
    onUpdateDownloadProgress: (callback: (progress: UpdateProgress) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: UpdateProgress) => callback(progress);
      ipcRenderer.on(IPC_CHANNELS.UPDATE_DOWNLOAD_PROGRESS, listener);
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.UPDATE_DOWNLOAD_PROGRESS, listener);
      };
    },
    onUpdateAvailable: (callback: (info: { latestVersion: string; releaseUrl: string }) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, info: { latestVersion: string; releaseUrl: string }) => callback(info);
      ipcRenderer.on(IPC_CHANNELS.APP_UPDATE_AVAILABLE, listener);
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.APP_UPDATE_AVAILABLE, listener);
      };
    },
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// Type declaration for TypeScript (used in renderer)
export type ElectronAPI = typeof electronAPI;
