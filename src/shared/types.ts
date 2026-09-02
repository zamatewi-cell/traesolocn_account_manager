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

/** Account data safe to expose to the renderer (no reusable credentials). */
export type AccountView = Omit<Account, 'token' | 'refreshToken'> & {
  hasRefreshToken: boolean;
};

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

/** Local-session metadata safe to display without exposing its credentials. */
export type LocalAccountView = Omit<LocalAccountInfo, 'token' | 'refreshToken' | 'authBlob'>;

// One account entry in a v2 export file (snake_case, aligned with the
// Cockpit-style reference format so exported files carry full credentials)
export interface ExportAccountEntry {
  /** Stable id: "trae_" + md5(userId) */
  id?: string;
  nickname: string;
  email?: string | null;
  phone?: string | null;
  user_id?: string | null;
  avatar_url?: string | null;
  host?: string;
  access_token?: string;
  refresh_token?: string | null;
  /** ISO string or epoch seconds */
  expires_at?: string | number | null;
  plan_type?: string | null;
  plan_reset_at?: string | null;
  credits_balance?: number;
  source?: string;
  install_name?: string | null;
  entitlement_packs?: EntitlementPack[] | null;
  /** Complete decrypted auth blob from storage.json (credential-bearing) */
  trae_auth_raw?: TraeAuthData | null;
  /** Profile snapshot (what we know without re-fetching) */
  trae_profile_raw?: { nickname: string | null; email: string | null; userId: string | null; avatarUrl: string | null; phone: string | null } | null;
  /** Entitlement packs snapshot (Cockpit keeps the raw API response here) */
  trae_entitlement_raw?: EntitlementPack[] | null;
  usage_updated_at?: string | null;
  last_used?: number | null;
  created_at?: string;
  updated_at?: string;
  last_refreshed_at?: string | null;
  // v1 legacy fields (camelCase)
  userId?: string | null;
  token?: string;
}

export interface ExportAccount {
  version: 2;
  exportedAt: string;
  accounts: ExportAccountEntry[];
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
  /** 开启自动签到 */
  autoCheckinEnabled: boolean;
  /** 自动签到随机时间窗开始（HH:mm，本地时间） */
  autoCheckinStart: string;
  /** 自动签到随机时间窗结束（HH:mm，本地时间） */
  autoCheckinEnd: string;
}

// Per-account result inside an auto-checkin run record
export interface AutoCheckinAccountResult {
  accountId: number;
  accountName: string;
  success: boolean;
  alreadyClaimed: boolean;
  creditsEarned: number;
  message: string;
}

// One automatic check-in execution (scheduled run or manual test run)
export interface AutoCheckinRecord {
  id: number;
  /** 'auto' = 定时触发, 'manual' = 测试执行 */
  triggerType: 'auto' | 'manual';
  /** 本地时间 ISO 字符串 */
  runAt: string;
  durationMs: number;
  successCount: number;
  alreadyCount: number;
  failedCount: number;
  total: number;
  results: AutoCheckinAccountResult[];
}

// Live scheduler state for the UI
export interface AutoCheckinStatus {
  enabled: boolean;
  start: string;
  end: string;
  /** 下次计划触发时间（本地 ISO），未启用或无法计算时为 null */
  nextRunAt: string | null;
  /** 今天是否已成功处理过账号，或已达到自动重试上限 */
  hasRunToday: boolean;
}

// Installer asset attached to a GitHub release
export interface UpdateAsset {
  name: string;
  url: string;
  size: number;
  /** Base64-encoded SHA-512 from electron-builder's latest.yml. */
  sha512: string;
}

// Result of a GitHub Releases update check
export interface UpdateInfo {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
  releaseNotes: string;
  asset: UpdateAsset | null;
}

// Progress of an update installer download
export interface UpdateProgress {
  received: number;
  total: number;
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
  ACCOUNTS_UPDATED: 'accounts:updated',
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
  APP_GET_VERSION: 'app:get-version',
  APP_CHECK_UPDATE: 'app:check-update',
  APP_UPDATE_AVAILABLE: 'app:update-available',
  APP_DOWNLOAD_UPDATE: 'app:download-update',
  APP_INSTALL_UPDATE: 'app:install-update',
  APP_OPEN_RELEASE_PAGE: 'app:open-release-page',
  UPDATE_DOWNLOAD_PROGRESS: 'update:download-progress',
  AUTOCHECKIN_GET_STATUS: 'autocheckin:get-status',
  AUTOCHECKIN_SET_SETTINGS: 'autocheckin:set-settings',
  AUTOCHECKIN_RUN_TEST: 'autocheckin:run-test',
  AUTOCHECKIN_GET_RECORDS: 'autocheckin:get-records',
  AUTOCHECKIN_CLEAR_RECORDS: 'autocheckin:clear-records',
  AUTOCHECKIN_COMPLETED: 'autocheckin:completed',
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
