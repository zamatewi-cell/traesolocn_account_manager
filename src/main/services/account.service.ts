import { getDatabase } from './database';
import { getCryptoService } from './crypto.service';
import { getApiService } from './api.service';
import { getTraeworkService } from './traework.service';
import { store } from '../utils/store';
import { logger } from '../utils/logger';
import { findExistingTraeStorage } from '../utils/paths';
import fs from 'fs';
import type { Account, ExportAccount, CreditsInfo, LocalAccountInfo, TraeAuthData, EntitlementPack, UserInfo, UsageRecord } from '../../shared/types';

interface AccountRow {
  id: number;
  nickname: string;
  email: string | null;
  user_id: string | null;
  avatar_url: string | null;
  phone: string | null;
  token_encrypted: Buffer;
  refresh_token: string | null;
  host: string;
  source: string;
  install_name: string | null;
  is_active: number;
  is_checked_in: number;
  checkin_credits: number;
  last_checkin_at: string | null;
  credits_balance: number;
  today_usage: number;
  total_usage: number;
  pay_status: string | null;
  pay_identity_str: string | null;
  pay_expire_at: string | null;
  entitlement_packs: string | null;
  token_expired_at: string | null;
  created_at: string;
  updated_at: string;
  last_refreshed_at: string | null;
  deleted_at: string | null;
}

/**
 * Check whether a stored timestamp falls on today.
 * Handles both SQLite datetime('now') format ("YYYY-MM-DD HH:MM:SS", UTC)
 * and ISO strings. Comparison is done in local time so the checkin badge
 * resets at local midnight, matching user expectation.
 */
function isStoredDateToday(dateStr: string | null): boolean {
  if (!dateStr) return false;
  // Normalize SQLite UTC format to a parseable ISO string
  const normalized = dateStr.includes('T')
    ? dateStr
    : dateStr.replace(' ', 'T') + 'Z';
  const d = new Date(normalized);
  if (isNaN(d.getTime())) return false;
  const now = new Date();
  return d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
}

function rowToAccount(row: AccountRow, token: string): Account {
  let entitlementPacks: EntitlementPack[] = [];
  if (row.entitlement_packs) {
    try {
      entitlementPacks = JSON.parse(row.entitlement_packs);
    } catch {
      entitlementPacks = [];
    }
  }

  // The checkin flag must not survive across days: if the last checkin was
  // not today (UTC, matching SQLite datetime('now') storage), treat the
  // account as not checked in. The next refresh syncs the real status.
  const checkedInToday = row.is_checked_in === 1 && isStoredDateToday(row.last_checkin_at);

  return {
    id: row.id,
    nickname: row.nickname,
    email: row.email,
    userId: row.user_id,
    avatarUrl: row.avatar_url,
    phone: row.phone,
    token,
    refreshToken: row.refresh_token,
    host: row.host || 'https://api.trae.cn',
    isActive: row.is_active === 1,
    isCheckedIn: checkedInToday,
    checkinCredits: row.checkin_credits || 0,
    lastCheckinAt: row.last_checkin_at,
    creditsBalance: row.credits_balance,
    todayUsage: row.today_usage || 0,
    totalUsage: row.total_usage || 0,
    payStatus: row.pay_status,
    payIdentityStr: row.pay_identity_str,
    payExpireAt: row.pay_expire_at,
    entitlementPacks,
    tokenExpiredAt: row.token_expired_at,
    source: row.source as Account['source'],
    installName: row.install_name || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastRefreshedAt: row.last_refreshed_at,
  };
}

export class AccountService {
  private crypto = getCryptoService();
  private api = getApiService();
  private traework = getTraeworkService();
  private deviceId: string | null = null;

  /**
   * Get a stable device ID for checkin API calls.
   *
   * Priority:
   * 1. The REAL device ID registered by the installed Trae app (from storage.json
   *    key `iCubeAuthInfo://icube-dc:{deviceId}`). The checkin claim API rejects
   *    random device IDs with code 9074 ("操作太过频繁"), so reusing Trae's own
   *    device ID is required for the claim to succeed.
   * 2. A persisted random ID (fallback when no local Trae storage exists).
   */
  getDeviceId(): string {
    if (!this.deviceId) {
      // Prefer the real device ID registered by the installed Trae app
      try {
        const traeDeviceId = this.traework.getTraeDeviceId();
        if (traeDeviceId) {
          this.deviceId = traeDeviceId;
          store.set('checkin_device_id', traeDeviceId);
          return this.deviceId;
        }
      } catch (err) {
        logger.warn('Failed to read Trae device ID:', (err as Error).message);
      }

      let id = store.get<string>('checkin_device_id', '');
      if (!id) {
        id = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        store.set('checkin_device_id', id);
      }
      this.deviceId = id;
    }
    return this.deviceId;
  }

  /**
   * Get all accounts (non-deleted).
   */
  getAllAccounts(): Account[] {
    const db = getDatabase();
    const rows = db.prepare(
      'SELECT * FROM accounts WHERE deleted_at IS NULL ORDER BY is_active DESC, created_at DESC'
    ).all() as AccountRow[];

    return rows.map(row => {
      const token = this.crypto.decryptString(row.token_encrypted);
      return rowToAccount(row, token);
    });
  }

  /**
   * Get a single account by ID.
   */
  getAccountById(id: number): Account | null {
    const db = getDatabase();
    const row = db.prepare(
      'SELECT * FROM accounts WHERE id = ? AND deleted_at IS NULL'
    ).get(id) as AccountRow | undefined;

    if (!row) return null;

    const token = this.crypto.decryptString(row.token_encrypted);
    return rowToAccount(row, token);
  }

  /**
   * Find an account by user ID.
   */
  findAccountByUserId(userId: string): Account | null {
    const db = getDatabase();
    const row = db.prepare(
      'SELECT * FROM accounts WHERE user_id = ? AND deleted_at IS NULL'
    ).get(userId) as AccountRow | undefined;

    if (!row) return null;

    const token = this.crypto.decryptString(row.token_encrypted);
    return rowToAccount(row, token);
  }

  /**
   * Add a new account with the given token.
   * Fetches user info from API to populate nickname/email/avatar/credits.
   */
  async addAccount(
    token: string,
    source: Account['source'] = 'token_import',
    prefilledInfo?: Partial<Pick<Account, 'nickname' | 'email' | 'userId' | 'avatarUrl' | 'phone' | 'refreshToken' | 'host' | 'installName' | 'tokenExpiredAt'>>,
    authBlob?: TraeAuthData
  ): Promise<Account> {
    const host = prefilledInfo?.host || 'https://api.trae.cn';

    // Try to get user info, entitlements, and pay status from API in parallel
    let userInfo: UserInfo | null = null;
    let payStatus: CreditsInfo = { balance: 0 };
    let entitlements: EntitlementPack[] = [];

    try {
      [userInfo, entitlements, payStatus] = await Promise.all([
        this.api.getUserInfo(token, host).catch(() => null),
        this.api.getEntitlements(token, host).catch(() => [] as EntitlementPack[]),
        this.api.getPayStatus(token, host).catch((): CreditsInfo => ({ balance: 0 })),
      ]);
    } catch (err) {
      logger.warn('Failed to fetch account info from API during add:', (err as Error).message);
    }

    // Merge user info - prefer API data, then prefilled, then fallback
    const nickname = userInfo?.nickname 
      || prefilledInfo?.nickname 
      || payStatus.identityStr 
      || `账号 ${(token || '').substring(0, 8)}...`;
    const email = userInfo?.email || prefilledInfo?.email || null;
    const userId = userInfo?.userId || prefilledInfo?.userId || null;
    const avatarUrl = userInfo?.avatarUrl || prefilledInfo?.avatarUrl || null;
    const phone = prefilledInfo?.phone || null;

    // Check if account already exists
    if (userId) {
      const existing = this.findAccountByUserId(userId);
      if (existing) {
        // Update token and info for existing account
        return this.updateAccountToken(existing.id, token, {
          refreshToken: prefilledInfo?.refreshToken,
          host,
          installName: prefilledInfo?.installName,
          tokenExpiredAt: prefilledInfo?.tokenExpiredAt,
        }, authBlob);
      }
    }

    const db = getDatabase();
    const encryptedToken = this.crypto.encryptString(token);
    const entitlementPacksJson = entitlements.length > 0 ? JSON.stringify(entitlements) : null;
    const creditsBalance = this.computeCreditsBalance(entitlements);
    const encryptedBlob = authBlob
      ? this.crypto.encryptString(JSON.stringify(authBlob))
      : null;

    const result = db.prepare(`
      INSERT INTO accounts (
        nickname, email, user_id, avatar_url, phone,
        token_encrypted, refresh_token, host, source, install_name,
        credits_balance, pay_status, pay_identity_str, entitlement_packs, token_expired_at,
        auth_blob_encrypted
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      nickname,
      email,
      userId,
      avatarUrl,
      phone,
      encryptedToken,
      prefilledInfo?.refreshToken || null,
      host,
      source,
      prefilledInfo?.installName || null,
      creditsBalance,
      payStatus.payStatus || null,
      payStatus.identityStr || null,
      entitlementPacksJson,
      prefilledInfo?.tokenExpiredAt || null,
      encryptedBlob
    );

    const accountId = result.lastInsertRowid as number;

    // Do a full refresh to get checkin status etc.
    try {
      await this.refreshAccount(accountId);
    } catch (err) {
      logger.warn('Failed to refresh account after add:', (err as Error).message);
    }

    return this.getAccountById(accountId)!;
  }

  /**
   * Detect local Traework accounts and return info about them.
   */
  detectLocalAccounts(): LocalAccountInfo[] {
    return this.traework.detectLocalAccounts();
  }

  /**
   * Import a specific local account by its info.
   */
  async importLocalAccount(localInfo: LocalAccountInfo): Promise<Account> {
    if (!localInfo.token) {
      throw new Error('无法获取本地账号 Token，请确保已在 Trae 中登录');
    }

    // Add account with prefilled info from local storage
    const account = await this.addAccount(localInfo.token, 'local_import', {
      nickname: localInfo.nickname,
      email: localInfo.email,
      userId: localInfo.userId,
      avatarUrl: localInfo.avatarUrl,
      phone: localInfo.phone,
      refreshToken: localInfo.refreshToken,
      host: localInfo.host || 'https://api.trae.cn',
      installName: localInfo.installName,
      tokenExpiredAt: localInfo.expiredAt,
    }, localInfo.authBlob);

    return account;
  }

  /**
   * Import all detected local accounts.
   */
  async importAllLocalAccounts(): Promise<Account[]> {
    const localAccounts = this.detectLocalAccounts();
    if (localAccounts.length === 0) {
      throw new Error('未找到 Trae 本地登录账号，请先在 Trae 中登录');
    }

    const imported: Account[] = [];
    for (const localAccount of localAccounts) {
      try {
        const account = await this.importLocalAccount(localAccount);
        imported.push(account);
      } catch (err) {
        logger.warn(`Failed to import local account ${localAccount.nickname || localAccount.userId}:`, err);
      }
    }

    return imported;
  }

  /**
   * Recover accounts from local Trae storage.
   *
   * The app's own DB may hold tokens that can no longer be decrypted (e.g. they were
   * written by an older build using a different encryption format) or that have expired.
   * This method re-syncs every DB account with the live token/refreshToken from the
   * installed Trae storage.json files, and adds any local account not yet in the DB.
   *
   * It is safe to call on every startup: it only overwrites a DB account's token when
   * the local token is valid and the DB token is missing/invalid/expired.
   */
  async recoverAccountsFromLocal(): Promise<Account[]> {
    const localAccounts = this.traework.detectLocalAccounts();
    if (localAccounts.length === 0) {
      logger.info('[Recover] No local Trae accounts found, skipping recovery');
      return this.getAllAccounts();
    }

    const db = getDatabase();
    const dbAccounts = this.getAllAccounts();
    const recovered: Account[] = [];

    for (const local of localAccounts) {
      // Skip local accounts without a usable token
      if (!local.token || !this.crypto.isValidToken(local.token)) {
        logger.warn('[Recover] Local account has no valid token, skipping:', local.nickname || local.userId);
        continue;
      }

      // Find matching DB account by userId (preferred) or email. The row's
      // userId must also agree with the local session: writing account X's
      // live credentials into account Y's row is how identity corruption
      // starts (row Y then displays and switches as account X).
      const match = dbAccounts.find(
        a => ((local.userId && a.userId === local.userId) ||
             (local.email && a.email && a.email.toLowerCase() === local.email.toLowerCase())) &&
            (!a.userId || !local.userId || a.userId === local.userId)
      );

      if (match) {
        // Local Trae storage is the source of truth: always overwrite the DB token
        // with the live local token so the stored copy is valid and decryptable.
        const encryptedToken = this.crypto.encryptString(local.token);
        const encryptedBlob = local.authBlob
          ? this.crypto.encryptString(JSON.stringify(local.authBlob))
          : null;
        db.prepare(`
          UPDATE accounts
          SET token_encrypted = ?, refresh_token = COALESCE(?, refresh_token),
              token_expired_at = COALESCE(?, token_expired_at),
              host = ?, nickname = COALESCE(?, nickname), email = COALESCE(?, email),
              avatar_url = COALESCE(?, avatar_url),
              auth_blob_encrypted = COALESCE(?, auth_blob_encrypted),
              updated_at = datetime('now')
          WHERE id = ?
        `).run(
          encryptedToken,
          local.refreshToken || null,
          local.expiredAt || null,
          local.host || match.host,
          local.nickname || null,
          local.email || null,
          local.avatarUrl || null,
          encryptedBlob,
          match.id
        );
        logger.info(`[Recover] Restored token for account ${match.id} from local storage`);
        recovered.push(this.getAccountById(match.id)!);
      } else {
        // Add a new local account only if its token is not expired
        if (local.expiredAt && new Date(local.expiredAt).getTime() < Date.now()) {
          logger.warn('[Recover] Skipping expired local account:', local.nickname || local.userId);
          continue;
        }
        try {
          const account = await this.importLocalAccount(local);
          recovered.push(account);
          logger.info('[Recover] Added new local account:', account.nickname || account.userId);
        } catch (err) {
          logger.warn('[Recover] Failed to add local account:', (err as Error).message);
        }
      }
    }

    // ---- Repair pass for rows corrupted by older builds ----
    // An older build could store another account's refresh token in a row
    // (e.g. captured from the wrong OAuth channel). On the next refresh the
    // exchange then minted the OTHER user's token, and that user's profile,
    // credits and checkin state overwrote this row. Detect and fix:
    //   - token foreign + blob foreign  -> row is unrecoverable, retire it
    //   - token foreign + blob intact   -> restore credentials from blob
    for (const dbAccount of dbAccounts) {
      // Re-read the row: the loop above may have just replaced its token with
      // the live local one, so the in-memory snapshot could still hold the
      // pre-recovery (foreign) token and wrongly retire a repaired row.
      const row = this.getAccountById(dbAccount.id);
      if (!row) continue;
      const rowUserId = row.userId || null;
      if (!rowUserId) continue;
      const blob = this.getAccountAuthBlob(row.id);
      const tokenUserId = this.parseJwtIdentity(row.token);
      const blobForeign = !!(blob?.userId && blob.userId !== rowUserId);
      const tokenForeign = !!(tokenUserId && tokenUserId !== rowUserId);

      if (blobForeign && tokenForeign) {
        db.prepare("UPDATE accounts SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
          .run(dbAccount.id);
        logger.warn(
          `[Recover] Retired account row ${dbAccount.id} (${dbAccount.nickname}): its stored credentials all belong to user ${tokenUserId}. Re-add the account to restore it.`
        );
        continue;
      }

      if (!blobForeign && tokenForeign && blob?.token) {
        const encryptedToken = this.crypto.encryptString(blob.token);
        const encryptedBlob = this.crypto.encryptString(JSON.stringify(blob));
        db.prepare(`UPDATE accounts
          SET token_encrypted = ?, refresh_token = COALESCE(?, refresh_token),
              token_expired_at = COALESCE(?, token_expired_at), auth_blob_encrypted = ?,
              updated_at = datetime('now')
          WHERE id = ?`)
          .run(encryptedToken, blob.refreshToken || null, blob.expiredAt || null, encryptedBlob, row.id);
        logger.warn(
          `[Recover] Restored credentials for account ${row.id} from its auth blob (stored token belonged to user ${tokenUserId})`
        );
      }

      // Token is this user's but the stored blob belongs to someone else
      // (left behind by an older build): drop it so switches never see it.
      if (!tokenForeign && blobForeign) {
        db.prepare("UPDATE accounts SET auth_blob_encrypted = NULL, updated_at = datetime('now') WHERE id = ?")
          .run(row.id);
        logger.warn(
          `[Recover] Dropped foreign auth blob for account ${row.id} (blob user ${blob!.userId}, row user ${rowUserId})`
        );
      }
    }

    // ---- Duplicate user_id pass ----
    // The worst corruption shape overwrites a row's user_id as well, so the
    // row and its (foreign) credentials all agree on the wrong identity and
    // the checks above cannot see it. What remains visible is two rows
    // sharing one user_id: keep the active row (the real owner's), retire
    // the duplicate so the UI no longer shows mirrored accounts.
    const survivors = this.getAllAccounts();
    const byUserId = new Map<string, typeof survivors>();
    for (const a of survivors) {
      if (!a.userId) continue;
      const list = byUserId.get(a.userId) || [];
      list.push(a);
      byUserId.set(a.userId, list);
    }
    for (const [uid, list] of byUserId) {
      if (list.length < 2) continue;
      list.sort((x, y) => (y.isActive ? 1 : 0) - (x.isActive ? 1 : 0) || x.createdAt.localeCompare(y.createdAt));
      for (const dup of list.slice(1)) {
        db.prepare("UPDATE accounts SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
          .run(dup.id);
        logger.warn(
          `[Recover] Retired duplicate row ${dup.id} (${dup.nickname}): user ${uid} is already represented by account ${list[0].id}`
        );
      }
    }

    return recovered.filter(a => this.getAccountById(a.id));
  }

  /**
   * Harvest fresh credentials the local Trae client wrote into storage.json.
   * While Trae runs it refreshes its own token (access tokens live ~minutes,
   * the client silently renews them), so storage.json can hold a live token
   * + refresh token that this app's DB knows nothing about - exactly what
   * happens when an OAuth-imported row stored a dead web token. Rows whose
   * DB token is expired/older adopt the live credentials; rows without a
   * stored auth blob get the complete live blob so future switches are
   * structurally valid for Trae.
   */
  harvestLiveCredentials(): void {
    let locals: LocalAccountInfo[];
    try {
      locals = this.traework.detectLocalAccounts();
    } catch (err) {
      logger.warn('[Harvest] Failed to read local Trae storages:', (err as Error).message);
      return;
    }

    for (const local of locals) {
      if (!local.userId || !local.token || !this.crypto.isValidToken(local.token)) continue;
      const row = this.findAccountByUserId(local.userId);
      if (!row) continue;

      // Identity guard: the live token must provably belong to this row.
      if (this.tokenIdentityMismatch(local.token, row.userId)) {
        logger.warn(`[Harvest] Live token for user ${local.userId} does not match row ${row.id}; skipping`);
        continue;
      }

      const rowExpired = this.isTokenExpired(row.tokenExpiredAt);
      const localExpired = this.isTokenExpired(local.expiredAt);
      const rowBlob = this.getAccountAuthBlob(row.id);

      if (rowExpired && !localExpired) {
        this.persistToken(row.id, local.token, local.refreshToken || row.refreshToken, local.expiredAt || row.tokenExpiredAt);
        if (local.authBlob) this.saveAccountAuthBlob(row.id, local.authBlob);
        logger.info(`[Harvest] Adopted live credentials from local Trae for account ${row.id} (${row.nickname})`);
      } else if (!rowBlob && local.authBlob && !localExpired) {
        this.saveAccountAuthBlob(row.id, local.authBlob);
        if (!row.refreshToken && local.refreshToken) {
          this.persistToken(row.id, row.token, local.refreshToken, local.expiredAt || row.tokenExpiredAt);
        }
        logger.info(`[Harvest] Saved live auth blob for account ${row.id} (${row.nickname})`);
      }
    }
  }

  /**
   * Add account from OAuth flow token.
   * After OAuth login the account is the one logged into local Trae, so the
   * real blob in storage.json belongs to it - capture it for future switches.
   * The blob is matched by IDENTITY (blob user vs token user), not by token
   * equality: the OAuth web session and the local Trae client mint DIFFERENT
   * tokens for the same account, and the web token is short-lived - requiring
   * equality stored a dead token and dropped the client's complete blob.
   */
  async addAccountFromOAuth(token: string, host?: string, refreshToken?: string, expiredAt?: string): Promise<Account> {
    const realBlob = this.traework.getRealAuthBlob();
    let authBlob: TraeAuthData | undefined;
    let useToken = token;
    let useRefreshToken = refreshToken || undefined;
    let useExpiredAt = expiredAt;

    if (realBlob && realBlob.token) {
      const blobUserId = realBlob.userId || this.parseJwtIdentity(realBlob.token);
      const tokenUserId = this.parseJwtIdentity(token);
      if (blobUserId && tokenUserId && blobUserId === tokenUserId) {
        authBlob = realBlob;
        if (!this.isTokenExpired(realBlob.expiredAt)) {
          // The client's own token outlives the short-lived web token.
          useToken = realBlob.token;
          useRefreshToken = realBlob.refreshToken || refreshToken || undefined;
          useExpiredAt = realBlob.expiredAt || expiredAt;
          logger.info('OAuth: adopting the local client token/blob for the same account');
        } else {
          logger.info('OAuth: adopting the local client blob for the same account (client token expired, keeping web token)');
        }
      } else {
        logger.warn('OAuth: local storage blob belongs to a different account, skipping capture');
      }
    }

    return this.addAccount(useToken, 'oauth', {
      host: host || 'https://api.trae.cn',
      refreshToken: useRefreshToken,
      tokenExpiredAt: useExpiredAt,
    }, authBlob);
  }

  /**
   * Update token for an existing account.
   */
  async updateAccountToken(
    id: number,
    newToken: string,
    extraInfo?: Partial<Pick<Account, 'refreshToken' | 'host' | 'installName' | 'tokenExpiredAt'>>,
    authBlob?: TraeAuthData
  ): Promise<Account> {
    const encryptedToken = this.crypto.encryptString(newToken);
    const db = getDatabase();

    const updates: string[] = ['token_encrypted = ?', 'updated_at = datetime(\'now\')'];
    const values: unknown[] = [encryptedToken];

    if (authBlob) {
      updates.push('auth_blob_encrypted = ?');
      values.push(this.crypto.encryptString(JSON.stringify(authBlob)));
    }
    if (extraInfo?.refreshToken !== undefined) {
      updates.push('refresh_token = ?');
      values.push(extraInfo.refreshToken);
    }
    if (extraInfo?.host !== undefined) {
      updates.push('host = ?');
      values.push(extraInfo.host);
    }
    if (extraInfo?.installName !== undefined) {
      updates.push('install_name = ?');
      values.push(extraInfo.installName);
    }
    if (extraInfo?.tokenExpiredAt !== undefined) {
      updates.push('token_expired_at = ?');
      values.push(extraInfo.tokenExpiredAt);
    }

    values.push(id);

    db.prepare(
      `UPDATE accounts SET ${updates.join(', ')} WHERE id = ? AND deleted_at IS NULL`
    ).run(...values);

    try {
      await this.refreshAccount(id);
    } catch (err) {
      logger.warn('Failed to refresh account after token update:', (err as Error).message);
    }
    return this.getAccountById(id)!;
  }

  /**
   * Check whether a token has expired.
   */
  private isTokenExpired(expiredAt: string | null | undefined): boolean {
    if (!expiredAt) return false;
    const exp = new Date(expiredAt).getTime();
    if (isNaN(exp)) return false;
    return exp < Date.now();
  }

  /**
   * Persist a fresh token (and optional refresh token / expiry) back to the DB.
   * Used so the stored token stays valid and decryptable for later reads.
   */
  private persistToken(id: number, token: string, refreshToken?: string | null, expiredAt?: string | null): void {
    try {
      const db = getDatabase();
      const encryptedToken = this.crypto.encryptString(token);
      db.prepare(`
        UPDATE accounts
        SET token_encrypted = ?, refresh_token = COALESCE(?, refresh_token),
            token_expired_at = COALESCE(?, token_expired_at), updated_at = datetime('now')
        WHERE id = ?
      `).run(encryptedToken, refreshToken || null, expiredAt || null, id);
    } catch (err) {
      logger.warn(`Failed to persist token for account ${id}:`, (err as Error).message);
    }
  }

  /**
   * Compute the spendable credits balance from entitlement packs.
   * Sums the remaining quota (total - used) across packs that carry a quota.
   * This mirrors how cockpit-tools reports "剩余积分".
   */
  private computeCreditsBalance(entitlements: EntitlementPack[]): number {
    let total = 0;
    for (const pack of entitlements) {
      const quota = pack.entitlement_quota;
      if (!quota) continue;
      const totalQuota = quota.total_quota || 0;
      if (totalQuota <= 0) continue;
      const used = quota.used_quota || 0;
      total += Math.max(0, totalQuota - used);
    }
    return Math.round(total);
  }

  /**
   * Return a valid (non-expired) access token for the account.
   *
   * Priority:
   * 1. For local accounts, read the LIVE token from the installed Trae storage.json.
   *    This is the source of truth and is guaranteed valid (Trae is logged in), and it
   *    sidesteps the DB token encryption issues that caused API calls to fail.
   *    If the live token is expired, it is refreshed via the refresh token first.
   * 2. Otherwise use the DB token, refreshing it via the refresh token when expired.
   */
  private async ensureValidToken(account: Account): Promise<{ token: string; refreshToken: string | null }> {
    // 1. Prefer the live token from local Trae storage. storage.json is the
    //    source of truth - Trae keeps it refreshed while running - so ANY
    //    account matching by userId benefits, not just local_import rows.
    //    OAuth-imported accounts previously fell through to their (often
    //    short-lived, already expired) web token and switched Trae into the
    //    logged-out state.
    if (account.userId || account.source === 'local_import' || account.installName) {
      try {
        const localAccounts = this.traework.detectLocalAccounts();
        // Match by userId ONLY when the row has one. Falling back to
        // installName would grab whatever account is currently logged into
        // that installation - which may be a DIFFERENT user's session
        // (exactly how a foreign token once overwrote another account).
        const local = localAccounts.find(a =>
          account.userId
            ? a.userId === account.userId
            : (account.installName && a.installName === account.installName)
        );
        if (local && local.token && this.crypto.isValidToken(local.token)) {
          // Identity guard: never use a live token that provably belongs to
          // another user (e.g. this install is logged into someone else).
          if (this.tokenIdentityMismatch(local.token, account.userId)) {
            logger.error(
              `Live local token belongs to user ${this.parseJwtIdentity(local.token)}, not account ${account.id} (${account.userId}); ignoring it`
            );
          } else {
          const localExpired = this.isTokenExpired(local.expiredAt || account.tokenExpiredAt);

          // Live token is still valid: use it directly
          if (!localExpired) {
            this.persistToken(account.id, local.token, local.refreshToken || account.refreshToken, local.expiredAt || account.tokenExpiredAt);
            return { token: local.token, refreshToken: local.refreshToken || account.refreshToken };
          }

          // Live token is expired: try to refresh it via the refresh token
          const refreshToken = local.refreshToken || account.refreshToken;
          if (refreshToken) {
            try {
              const refreshed = await this.api.refreshToken(refreshToken, account.host || 'https://api.trae.cn', local.token);
              if (refreshed) {
                this.persistToken(account.id, refreshed.token, refreshed.refreshToken, refreshed.tokenExpiredAt);
                logger.info(`Refreshed expired local token for account ${account.id}`);
                return { token: refreshed.token, refreshToken: refreshed.refreshToken };
              }
            } catch (err) {
              logger.warn(`Failed to refresh expired local token for account ${account.id}:`, (err as Error).message);
            }
          }
          // Refresh failed: return the (expired) live token so the API call fails gracefully
          return { token: local.token, refreshToken: local.refreshToken || account.refreshToken };
          }
        }
      } catch (err) {
        logger.warn(`Failed to read live token for account ${account.id}:`, (err as Error).message);
      }
    }

    // 2. Fall back to the DB token, refreshing if expired/invalid
    let token = account.token;
    let refreshToken = account.refreshToken;

    const tokenIsValid = this.crypto.isValidToken(token);
    const tokenExpired = this.isTokenExpired(account.tokenExpiredAt);

    if ((!tokenIsValid || tokenExpired) && refreshToken) {
      try {
        const refreshed = await this.api.refreshToken(refreshToken, account.host || 'https://api.trae.cn', token);
        if (refreshed) {
          // Identity guard: if the exchange minted a token for a DIFFERENT
          // user (the stored refresh token belonged to another account's
          // session), never adopt or persist it - using it would overwrite
          // this row with the other account's identity and credits.
          if (this.tokenIdentityMismatch(refreshed.token, account.userId)) {
            logger.error(
              `Token refresh for account ${account.id} minted a token for user ${this.parseJwtIdentity(refreshed.token)} (row: ${account.userId}); discarding foreign token`
            );
          } else {
          token = refreshed.token;
          refreshToken = refreshed.refreshToken;
          this.persistToken(account.id, token, refreshToken, refreshed.tokenExpiredAt);
          logger.info(`Token refreshed for account ${account.id}`);
          }
        }
      } catch (err) {
        logger.warn(`Failed to refresh token for account ${account.id}:`, (err as Error).message);
      }
    }
    return { token, refreshToken };
  }

  /**
   * Refresh account data from API (user info, credits, checkin status, entitlements).
   * If the access token is expired, it is refreshed first using the refresh token.
   */
  async refreshAccount(id: number): Promise<Account> {
    const account = this.getAccountById(id);
    if (!account) {
      throw new Error('Account not found');
    }

    const db = getDatabase();
    const host = account.host || 'https://api.trae.cn';

    // Refresh the access token if it has expired
    const { token } = await this.ensureValidToken(account);

    // Identity guard: if the usable token provably belongs to another user,
    // every API response below (profile, credits, checkin state) would be
    // that other user's data. Applying it would overwrite this row's
    // identity - refuse instead so the account stays intact.
    if (this.tokenIdentityMismatch(token, account.userId)) {
      const msg = `Account ${id}: token belongs to user ${this.parseJwtIdentity(token)} (row: ${account.userId}); skipping refresh`;
      logger.error(msg);
      throw new Error('该账号的凭据与身份不匹配，已跳过刷新以保护数据（请重新导入该账号）');
    }

    try {
      const deviceId = this.getDeviceId();
      // Fetch user info, entitlements, pay status, and checkin status in parallel
      const [userInfo, entitlements, payStatus, checkinStatus] = await Promise.all([
        this.api.getUserInfo(token, host).catch(() => null),
        this.api.getEntitlements(token, host).catch(() => [] as EntitlementPack[]),
        this.api.getPayStatus(token, host).catch((): CreditsInfo => ({ balance: account.creditsBalance })),
        this.api.getCheckinStatus(token, host, deviceId).catch(() => null),
      ]);

      const updates: Record<string, unknown> = {
        last_refreshed_at: new Date().toISOString(),
        entitlement_packs: entitlements.length > 0 ? JSON.stringify(entitlements) : null,
        pay_status: payStatus?.payStatus ?? account.payStatus,
        pay_identity_str: payStatus?.identityStr ?? account.payIdentityStr,
      };

      // Update pay expire time if available
      if (payStatus?.expireAt) {
        updates.pay_expire_at = new Date(payStatus.expireAt).toISOString();
      }

      // Update user info from API if we got it. The JWT guard above already
      // rejected foreign tokens, but keep a belt-and-braces check here: a
      // row's user_id must never silently change once set.
      if (userInfo) {
        if (userInfo.nickname) {
          updates.nickname = userInfo.nickname;
        }
        if (userInfo.email) {
          updates.email = userInfo.email;
        }
        if (userInfo.userId && (!account.userId || userInfo.userId === account.userId)) {
          updates.user_id = userInfo.userId;
        }
        if (userInfo.avatarUrl) {
          updates.avatar_url = userInfo.avatarUrl;
        }
      } else if (payStatus?.identityStr && (!account.nickname || account.nickname.startsWith('账号 '))) {
        // Fallback to identity string if we don't have a nickname yet
        updates.nickname = payStatus.identityStr;
      }

      // Update checkin status
      if (checkinStatus) {
        updates.is_checked_in = checkinStatus.checkedIn ? 1 : 0;
        updates.checkin_credits = checkinStatus.credits;
        // If the API says checked in but the stored date is stale (e.g. the
        // user checked in from inside Trae directly), stamp it as today so
        // the day-rollover logic in rowToAccount sees a consistent pair.
        if (checkinStatus.checkedIn && !isStoredDateToday(account.lastCheckinAt)) {
          updates.last_checkin_at = new Date().toISOString().replace('T', ' ').slice(0, 19);
        }
      }

      // Update credits balance (computed from entitlement remaining quota)
      updates.credits_balance = this.computeCreditsBalance(entitlements);

      // Total usage = sum of used quota across entitlement packs
      let totalUsage = 0;
      for (const pack of entitlements) {
        const quota = pack.entitlement_quota;
        if (quota && quota.used_quota > 0) totalUsage += quota.used_quota;
      }
      if (totalUsage > 0) {
        updates.total_usage = Math.round(totalUsage * 100) / 100;
      }

      // Build dynamic update query
      const setClauses = Object.keys(updates).map(key => `${key} = ?`).join(', ');
      const values = [...Object.values(updates), id];

      db.prepare(
        `UPDATE accounts SET ${setClauses}, updated_at = datetime('now') WHERE id = ?`
      ).run(...values);

      // Today's usage from usage records (best-effort; non-fatal on failure)
      try {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const startTime = Math.floor(todayStart.getTime() / 1000);
        const endTime = Math.floor(Date.now() / 1000);
        // NOTE: the API rejects page_size > 50 with code 9004
        const pageSize = 50;
        let todayUsage = 0;
        let pageNum = 1;
        let fetched = 0;
        let total = Infinity;
        while (fetched < total && pageNum <= 10) {
          const usage = await this.api.getUsageRecords(token, host, { startTime, endTime, pageSize, pageNum });
          total = usage.total;
          const records = usage.user_usage_group_by_sessions;
          for (const rec of records) {
            todayUsage += rec.credits_consumed || 0;
          }
          fetched += records.length;
          if (records.length < pageSize) break;
          pageNum++;
        }
        db.prepare(`UPDATE accounts SET today_usage = ? WHERE id = ?`)
          .run(Math.round(todayUsage * 100) / 100, id);
      } catch (err) {
        logger.warn(`Failed to fetch today usage for account ${id}:`, (err as Error).message);
      }

    } catch (err) {
      logger.error(`Failed to refresh account ${id}:`, err);
      throw err;
    }

    return this.getAccountById(id)!;
  }

  /**
   * Refresh all accounts.
   */
  async refreshAllAccounts(): Promise<Account[]> {
    const accounts = this.getAllAccounts();
    const results: Account[] = [];

    // Refresh sequentially to avoid rate limiting
    for (const account of accounts) {
      try {
        const refreshed = await this.refreshAccount(account.id);
        results.push(refreshed);
      } catch (err) {
        logger.error(`Failed to refresh account ${account.id}:`, err);
        results.push(account);
      }
    }

    return results;
  }

  /**
   * Set an account as the active (currently logged into Traework) account.
   */
  setActiveAccount(id: number): void {
    const db = getDatabase();

    // Clear all active flags
    db.prepare('UPDATE accounts SET is_active = 0').run();

    // Set the specified account as active
    db.prepare('UPDATE accounts SET is_active = 1 WHERE id = ?').run(id);
  }

  /**
   * Get the active account.
   */
  getActiveAccount(): Account | null {
    const db = getDatabase();
    const row = db.prepare(
      'SELECT * FROM accounts WHERE is_active = 1 AND deleted_at IS NULL'
    ).get() as AccountRow | undefined;

    if (!row) return null;

    const token = this.crypto.decryptString(row.token_encrypted);
    return rowToAccount(row, token);
  }

  /**
   * Load the stored full auth blob for an account (decrypted), or null.
   */
  private getAccountAuthBlob(id: number): TraeAuthData | null {
    const db = getDatabase();
    const row = db.prepare(
      'SELECT auth_blob_encrypted FROM accounts WHERE id = ? AND deleted_at IS NULL'
    ).get(id) as { auth_blob_encrypted?: Buffer | null } | undefined;
    if (!row?.auth_blob_encrypted) return null;
    try {
      const parsed = JSON.parse(this.crypto.decryptString(row.auth_blob_encrypted));
      return parsed && typeof parsed === 'object' ? (parsed as TraeAuthData) : null;
    } catch (err) {
      logger.warn('Failed to decrypt stored auth blob:', (err as Error).message);
      return null;
    }
  }

  /**
   * Persist the full auth blob for an account (encrypted with DPAPI).
   */
  private saveAccountAuthBlob(id: number, blob: TraeAuthData): void {
    const db = getDatabase();
    db.prepare(
      "UPDATE accounts SET auth_blob_encrypted = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(this.crypto.encryptString(JSON.stringify(blob)), id);
  }

  /**
   * Extract the expiry timestamp from a JWT access token.
   */
  private parseJwtExp(token: string): string | undefined {
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64').toString('utf-8'));
      if (payload?.exp && typeof payload.exp === 'number') {
        return new Date(payload.exp * 1000).toISOString();
      }
    } catch {
      // not a JWT - fall through
    }
    return undefined;
  }

  /**
   * Extract the user identity from a Trae JWT access token.
   * Trae JWTs carry payload.data.id (the numeric user id string).
   * Returns null when the token is not a parseable JWT or has no id claim.
   */
  private parseJwtIdentity(token: string | null | undefined): string | null {
    if (!token) return null;
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64').toString('utf-8'));
      const id = payload?.data?.id ?? payload?.user_id ?? payload?.sub ?? null;
      return typeof id === 'string' && id ? id : (typeof id === 'number' ? String(id) : null);
    } catch {
      return null;
    }
  }

  /**
   * True when the token provably belongs to a different user than the account
   * row. Returns false when identity is unknown (non-JWT token) or matches.
   * This is the core guard that prevents one account's credentials from
   * overwriting another account's row (identity, credits, checkin state).
   */
  private tokenIdentityMismatch(token: string | null | undefined, userId: string | null | undefined): boolean {
    if (!userId) return false;
    const tokenUserId = this.parseJwtIdentity(token);
    return !!tokenUserId && tokenUserId !== userId;
  }

  /**
   * Build the complete TraeAuthData to write into storage.json when switching.
   *
   * Trae validates structural fields (userRegion, account.scope, loginScope,
   * storeRegion, userTag, ...) when restoring a session from storage.json. A
   * minimal hand-built blob makes Trae treat the session as invalid and show
   * the logged-out state. Therefore:
   *   1. start from the full blob stored when the account was imported;
   *   2. else use the real blob currently in local storage.json as template;
   *   3. else build a minimal blob with CN region defaults.
   * In all cases the fresh token fields are applied on top, and account-level
   * personal fields (username/avatar/mobile/email) are replaced with the
   * target account's own values (or removed when unknown, so a template
   * account's personal data never leaks into the written blob).
   */
  private buildSwitchAuthData(
    account: Account,
    token: string,
    refreshToken: string | null
  ): TraeAuthData {
    let base = this.getAccountAuthBlob(account.id);
    if (base) {
      // The blob must belong to this account. A foreign blob (e.g. written
      // by an older build during corrupted-token switches) would smuggle
      // another user's session into storage.json - use the local template
      // instead so only this account's personal data is written.
      if (base.userId && account.userId && base.userId !== account.userId) {
        logger.warn(`Switch: stored blob for account ${account.id} belongs to user ${base.userId}; ignoring it`);
        base = this.traework.getRealAuthBlob() || null;
      } else {
        logger.info(`Switch: using stored auth blob for account ${account.id}`);
      }
    }
    if (!base) {
      base = this.traework.getRealAuthBlob();
      if (base) {
        logger.info(`Switch: using local storage blob as template for account ${account.id}`);
      }
    }

    const authData: TraeAuthData = {
      ...(base || {}),
      token,
      refreshToken: refreshToken || base?.refreshToken,
      userId: account.userId || base?.userId || '',
      host: account.host || base?.host,
      expiredAt: this.parseJwtExp(token) || account.tokenExpiredAt || base?.expiredAt,
      account: { ...(base?.account || {}) } as TraeAuthData['account'],
    };

    if (!authData.userRegion) {
      authData.userRegion = { region: 'CN', _aiRegion: 'CN' };
    }

    const acc: Record<string, unknown> = { ...(authData.account || {}) };
    if (account.nickname) {
      acc.username = account.nickname;
      acc.nickname = account.nickname;
    }
    const personal: Array<[string, string | null | undefined]> = [
      ['avatar_url', account.avatarUrl],
      ['avatarUrl', account.avatarUrl],
      ['nonPlainTextMobile', account.phone],
      ['email', account.email],
    ];
    for (const [key, value] of personal) {
      if (value) {
        acc[key] = value;
      } else {
        delete acc[key];
      }
    }
    authData.account = acc as TraeAuthData['account'];

    return authData;
  }

  /**
   * Switch Traework to use the specified account.
   *
   * @param options.autoCloseTrae 切号前自动关闭 Trae（若在运行）
   * @param options.autoRestartTrae 切号后自动重启 Trae
   * @param options.traeExePath Trae 可执行文件路径（留空自动检测）
   */
  async switchToAccount(
    id: number,
    storagePath?: string,
    options?: { autoCloseTrae?: boolean; autoRestartTrae?: boolean; traeExePath?: string }
  ): Promise<Account & { traeRestarted?: boolean; traeExeLaunched?: string | null }> {
    const account = this.getAccountById(id);
    if (!account) {
      throw new Error('账号不存在');
    }

    const autoClose = options?.autoCloseTrae ?? false;
    const autoRestart = options?.autoRestartTrae ?? false;

    // Capture exe paths of running Trae processes BEFORE closing them,
    // so we can restart exactly what was closed
    let capturedExePaths: string[] = [];

    // Check if Traework is running
    const running = await this.traework.isTraeworkRunning();
    if (running && !autoClose) {
      throw new Error('请先关闭 Trae 再切换账号');
    }

    // Auto-close Trae before switching (if enabled and running)
    if (running && autoClose) {
      logger.info(`Auto-closing Trae before switching to account ${account.id}...`);
      capturedExePaths = await this.traework.getRunningTraeExePaths();
      await this.traework.closeTraework();
      // Give the process a moment to fully exit and flush storage.json
      await new Promise(resolve => setTimeout(resolve, 1500));
    }

    // Use a valid (live) token for switching
    const { token, refreshToken } = await this.ensureValidToken(account);

    // Identity guard: writing a foreign token into storage.json would log
    // Trae into the WRONG account (the switch looks like a no-op).
    if (this.tokenIdentityMismatch(token, account.userId)) {
      logger.error(`Switch refused for account ${id}: token belongs to user ${this.parseJwtIdentity(token)} (row: ${account.userId})`);
      throw new Error('该账号的凭据与身份不匹配，无法切换（请删除后重新导入该账号）');
    }

    // Build the complete auth blob for switching. Trae validates fields like
    // userRegion / scope / loginScope when reading storage.json; a hand-built
    // minimal blob makes Trae fall back to the logged-out state. So:
    // 1) use the full blob captured when the account was imported, or
    // 2) use the current real blob from local storage.json as a template, or
    // 3) build a minimal one with default region fields (last resort).
    const authData = this.buildSwitchAuthData(account, token, refreshToken);

    // Switch in every existing Trae storage so all installations (Trae CN /
    // TRAE SOLO CN) pick up the new account
    const targets = storagePath
      ? [{ storagePath }]
      : findExistingTraeStorage().map(s => ({ storagePath: s.storagePath }));

    if (targets.length === 0) {
      throw new Error('未找到 Trae 存储文件，请先运行 Trae 并登录');
    }

    for (const target of targets) {
      await this.traework.switchAccount(authData, target.storagePath, { allowRunning: true });
    }

    // Persist the full blob back onto the account record so future switches
    // (and older accounts imported before this column existed) always have it.
    try {
      this.saveAccountAuthBlob(id, authData);
    } catch (err) {
      logger.warn('Failed to persist auth blob after switch:', (err as Error).message);
    }

    // Update active flag
    this.setActiveAccount(id);

    // Auto-restart Trae after switching (if enabled):
    // prefer the configured path, then the exes we just closed, then auto-detect
    let traeRestarted: boolean | undefined;
    let traeExeLaunched: string | null = null;

    if (autoRestart) {
      logger.info(`Auto-launching Trae after switching to account ${account.id}...`);
      const launchTargets: string[] = [];
      if (options?.traeExePath && fs.existsSync(options.traeExePath)) {
        launchTargets.push(options.traeExePath);
      } else {
        launchTargets.push(...capturedExePaths);
      }

      let launched: string[] = [];
      if (launchTargets.length > 0) {
        launched = await this.traework.launchTraeworkPaths(launchTargets);
      }
      if (launched.length === 0) {
        // Fallback: full auto-detection chain
        const fallback = await this.traework.launchTraework();
        if (fallback) launched = [fallback];
      }

      traeRestarted = launched.length > 0;
      traeExeLaunched = launched[0] || null;
      if (!traeRestarted) {
        logger.warn('Trae restart failed: no executable found to launch');
      }
    }

    return { ...this.getAccountById(id)!, traeRestarted, traeExeLaunched };
  }

  /**
   * Delete an account (soft delete).
   */
  deleteAccount(id: number): void {
    const db = getDatabase();
    db.prepare(`
      UPDATE accounts SET deleted_at = datetime('now'), is_active = 0, updated_at = datetime('now')
      WHERE id = ?
    `).run(id);
  }

  /**
   * Export accounts to JSON file.
   */
  exportAccounts(ids?: number[], filePath?: string): ExportAccount {
    let accounts = this.getAllAccounts();

    if (ids && ids.length > 0) {
      const idSet = new Set(ids);
      accounts = accounts.filter(a => idSet.has(a.id));
    }

    const exportData: ExportAccount = {
      version: 1,
      exportedAt: new Date().toISOString(),
      accounts: accounts.map(a => ({
        nickname: a.nickname,
        email: a.email,
        userId: a.userId,
        token: a.token,
      })),
    };

    if (filePath) {
      fs.writeFileSync(filePath, JSON.stringify(exportData, null, 2), 'utf-8');
    }

    return exportData;
  }

  /**
   * Import accounts from a JSON file.
   */
  async importAccountsFromFile(filePath: string): Promise<Account[]> {
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content) as ExportAccount;

    if (data.version !== 1) {
      throw new Error('不支持的导出文件版本');
    }

    const importedAccounts: Account[] = [];

    for (const acc of data.accounts) {
      try {
        const account = await this.addAccount(acc.token, 'token_import', {
          nickname: acc.nickname,
          email: acc.email || undefined,
          userId: acc.userId || undefined,
        });
        importedAccounts.push(account);
      } catch (err) {
        logger.warn(`Failed to import account ${acc.nickname}:`, err);
      }
    }

    return importedAccounts;
  }

  /**
   * Perform checkin for an account.
   */
  async performCheckin(id: number): Promise<{ success: boolean; creditsEarned: number; message: string; alreadyCheckedIn: boolean }> {
    const account = this.getAccountById(id);
    if (!account) {
      throw new Error('账号不存在');
    }

    const host = account.host || 'https://api.trae.cn';
    const deviceId = this.getDeviceId();

    // Ensure we have a valid (non-expired) token
    const { token } = await this.ensureValidToken(account);

    // Identity guard: never claim a checkin with a token that belongs to
    // another user - it would consume the OTHER account's daily checkin
    // and then overwrite this row with that account's data on refresh.
    if (this.tokenIdentityMismatch(token, account.userId)) {
      logger.error(`Checkin refused for account ${id}: token belongs to user ${this.parseJwtIdentity(token)} (row: ${account.userId})`);
      return {
        success: false,
        creditsEarned: 0,
        message: '该账号的凭据与身份不匹配，签到已跳过（请删除后重新导入该账号）',
        alreadyCheckedIn: false,
      };
    }

    // First check current checkin status
    const status = await this.api.getCheckinStatus(token, host, deviceId);

    if (status.checkedIn) {
      return {
        success: true,
        creditsEarned: 0,
        message: '今日已签到',
        alreadyCheckedIn: true,
      };
    }

    // Perform checkin
    const result = await this.api.claimCheckin(token, host, deviceId);

    if (result.success) {
      // Update account status.
      // NOTE: the claim response does not include a new balance, so we add the
      // earned credits to the existing balance instead of overwriting it.
      const db = getDatabase();
      db.prepare(`
        UPDATE accounts
        SET is_checked_in = 1,
            checkin_credits = COALESCE(checkin_credits, 0) + ?,
            last_checkin_at = datetime('now'),
            credits_balance = credits_balance + ?,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(result.creditsEarned, result.creditsEarned, id);

      // Refresh to get updated info
      try {
        await this.refreshAccount(id);
      } catch {
        // Ignore refresh errors after successful checkin
      }
    }

    return {
      success: result.success,
      creditsEarned: result.creditsEarned,
      message: result.success ? `签到成功！获得 ${result.creditsEarned} 积分` : '签到失败',
      alreadyCheckedIn: result.alreadyClaimed,
    };
  }

  /**
   * Fetch detailed usage records for an account.
   * Uses a valid (non-expired) token and the Cloud-IDE-JWT auth scheme.
   */
  async getUsageRecords(
    id: number,
    options?: { startTime?: number; endTime?: number; pageSize?: number; pageNum?: number }
  ): Promise<{ total: number; records: UsageRecord[] }> {
    const account = this.getAccountById(id);
    if (!account) {
      throw new Error('账号不存在');
    }

    const host = account.host || 'https://api.trae.cn';
    const { token } = await this.ensureValidToken(account);

    const result = await this.api.getUsageRecords(token, host, options);
    return {
      total: result.total,
      records: result.user_usage_group_by_sessions,
    };
  }
}

// Singleton
let accountServiceInstance: AccountService | null = null;

export function getAccountService(): AccountService {
  if (!accountServiceInstance) {
    accountServiceInstance = new AccountService();
  }
  return accountServiceInstance;
}
