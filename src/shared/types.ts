// Shared types between main and renderer processes

export interface Account {
  id: number;
  nickname: string;
  email: string | null;
  userId: string | null;
  avatarUrl: string | null;
  phone: string | null;
  token: string;
  refreshToken: string | null;
  host: string;
  isActive: boolean;
  isCheckedIn: boolean;
  checkinCredits: number;
  lastCheckinAt: string | null;
  creditsBalance: number;
  todayUsage: number;
  totalUsage: number;
  payStatus: string | null;
  payIdentityStr: string | null;
  payExpireAt: string | null;
  entitlementPacks: EntitlementPack[];
  tokenExpiredAt: string | null;
  source: 'oauth' | 'token_import' | 'local_import';
  installName?: string;
  createdAt: string;
  updatedAt: string;
  lastRefreshedAt: string | null;
}

// Quota information for an entitlement
export interface EntitlementQuota {
  total_quota: number;
  used_quota: number;
  unit: string;
}

// Entitlement information
export interface Entitlement {
  entitlement_id: string;
  entitlement_key: string;
  entitlement_name: string;
  entitlement_desc: string;
}

// Entitlement pack as returned by API
export interface EntitlementPack {
  entitlement_pack_id: string;
  entitlement_pack_name: string;
  entitlement_pack_desc: string;
  product_id: string;
  start_time: number;
  expire_time: number;
  status: number;
  entitlement: Entitlement;
  entitlement_quota: EntitlementQuota | null;
}

// Pay status response
export interface PayStatus {
  balance?: number;
  payStatus?: string;
  identityStr?: string;
  expireAt?: number;
  isPayFreshman?: boolean;
}

export interface CheckinResult {
  accountId: number;
  accountName?: string;
  success: boolean;
  alreadyClaimed: boolean;
  creditsEarned: number;
  newBalance: number;
  message: string;
}

export interface BatchCheckinResult {
  total: number;
  success: number;
  alreadyClaimed: number;
  failed: number;
  results: CheckinResult[];
  errors: Array<{ accountId: number; accountName?: string; error: string }>;
}

export interface TraeAccountInfo {
  username?: string;
  nickname?: string;
  email?: string;
  avatar_url?: string;
  avatarUrl?: string;
  organization?: string;
  work_country?: string;
  description?: string;
  scope?: string;
  loginScope?: string;
  nonPlainTextMobile?: string;
  storeCountryCode?: string;
  storeCountrySrc?: string;
  storeRegion?: string;
  userTag?: string;
  migrateToSG?: boolean;
  iss?: string;
  iat?: number;
  [key: string]: unknown;
}

export interface TraeAuthData {
  token: string;
  refreshToken?: string;
  expiredAt?: string;
  refreshExpiredAt?: string;
  tokenReleaseAt?: string;
  userId: string;
  host?: string;
  userRegion?: { region?: string; _aiRegion?: string };
  account?: TraeAccountInfo;
}

export interface LocalAccountInfo {
  exists: boolean;
  nickname?: string;
  email?: string;
  userId?: string;
  avatarUrl?: string;
  phone?: string;
  installName?: string;
  storagePath?: string;
  token?: string;
  refreshToken?: string;
  host?: string;
  expiredAt?: string;
  userRegion?: string;
  accountInfo?: TraeAccountInfo;
  /** Complete decrypted auth blob straight from storage.json (all fields). */
  authBlob?: TraeAuthData;
}

export interface ExportAccount {
  version: 1;
  exportedAt: string;
  accounts: Array<{
    nickname: string;
    email: string | null;
    userId: string | null;
    token: string;
  }>;
}

export interface UserInfo {
  userId?: string;
  nickname?: string;
  email?: string;
  avatarUrl?: string;
}

export interface CreditsInfo {
  balance: number;
  workCredits?: number;
  payStatus?: string;
  identityStr?: string;
  expireAt?: number;
  isPayFreshman?: boolean;
  entitlementPacks?: EntitlementPack[];
}

export interface CheckinStatus {
  checkedIn: boolean;
  canCheckin: boolean;
  credits: number;
  enable: boolean;
}

// Language type
export type Language = 'zh' | 'en';

// App settings (persisted in config.json)
export interface AppSettings {
  /** 切号时自动关闭 Trae */
  autoCloseTrae: boolean;
  /** 切号后自动重启 Trae */
  autoRestartTrae: boolean;
  /** Trae 可执行文件路径（留空则自动检测） */
  traeExePath: string;
}

// Detailed usage record for a single session
export interface UsageRecord {
  session_id: string;
  session_start_time: number;
  session_end_time: number;
  model_name: string;
  product_name: string;
  credits_consumed: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  usage_desc?: string;
  [key: string]: unknown;
}

// Response for query_user_usage_group_by_session
export interface UsageRecordResponse {
  total: number;
  user_usage_group_by_sessions: UsageRecord[];
}

// IPC channel names
export const IPC_CHANNELS = {
  ACCOUNT_LIST: 'account:list',
  ACCOUNT_ADD_OAUTH: 'account:add:oauth',
  ACCOUNT_ADD_TOKEN: 'account:add:token',
  ACCOUNT_ADD_LOCAL: 'account:add:local',
  ACCOUNT_IMPORT_JSON: 'account:import:json',
  ACCOUNT_EXPORT: 'account:export',
  ACCOUNT_DELETE: 'account:delete',
  ACCOUNT_SWITCH: 'account:switch',
  ACCOUNT_REFRESH: 'account:refresh',
  ACCOUNT_REFRESH_ALL: 'account:refresh:all',
  CHECKIN_SINGLE: 'checkin:single',
  CHECKIN_BATCH: 'checkin:batch',
  CHECKIN_STATUS: 'checkin:status',
  USAGE_RECORDS: 'usage:records',
  STORAGE_DETECT_LOCAL: 'storage:detect-local',
  STORAGE_DETECT_ALL_LOCAL: 'storage:detect-all-local',
  DIALOG_OPEN_FILE: 'dialog:open-file',
  DIALOG_SAVE_FILE: 'dialog:save-file',
  APP_CHECK_TRAEWORK_RUNNING: 'app:check-traework-running',
  APP_GET_LANGUAGE: 'app:get-language',
  APP_SET_LANGUAGE: 'app:set-language',
  APP_GET_SETTINGS: 'app:get-settings',
  APP_SET_SETTINGS: 'app:set-settings',
  APP_DETECT_TRAE_EXE: 'app:detect-trae-exe',
  APP_CLOSE_TRAEWORK: 'app:close-traework',
  APP_LAUNCH_TRAEWORK: 'app:launch-traework',
} as const;

// IPC response wrapper
export interface IpcResponse<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

// Generic API response
export interface AnyResponse {
  success: boolean;
  data?: unknown;
  error?: string;
}
