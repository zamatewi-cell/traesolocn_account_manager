import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/types';
import type { Account, CheckinResult, BatchCheckinResult, LocalAccountInfo, IpcResponse, Language, AppSettings, UsageRecord } from '../shared/types';

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
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// Type declaration for TypeScript (used in renderer)
export type ElectronAPI = typeof electronAPI;
