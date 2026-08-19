import fs from 'fs';
import path from 'path';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { findExistingTraeStorage, getTraeStoragePaths } from '../utils/paths';
import { writeJsonAtomic, restoreFromBackup } from '../utils/atomic-file';
import { getCryptoService } from './crypto.service';
import { logger } from '../utils/logger';
import { store } from '../utils/store';
import type { LocalAccountInfo, TraeAuthData } from '../../shared/types';

const execAsync = promisify(exec);

// Common Trae executable locations (in priority order).
// Includes both "Programs"-style installers and drive-root installs like D:\TRAE SOLO CN\.
const COMMON_TRAE_EXE_PATHS = [
  (p: string) => path.join(p, 'TRAE SOLO CN', 'TRAE SOLO CN.exe'),
  (p: string) => path.join(p, 'Trae CN', 'Trae CN.exe'),
  (p: string) => path.join(p, 'Programs', 'TRAE SOLO CN', 'TRAE SOLO CN.exe'),
  (p: string) => path.join(p, 'Programs', 'Trae CN', 'Trae CN.exe'),
  (p: string) => path.join(p, 'Programs', 'Trae', 'Trae.exe'),
  (p: string) => path.join(p, 'Programs', 'TRAE SOLO CN', 'TRAE SOLO CN.exe'),
];

// Executable preference order, mirroring COMMON_TRAE_EXE_PATHS. A machine can
// run several Trae products at once, and they are NOT interchangeable:
//   "TRAE SOLO CN.exe" = TraeWork CN product (directory keeps the old
//                        TraeSolo CN name after the product rename) - this is
//                        the product this account manager is built for;
//   "Trae CN.exe"      = TraeCode CN (the classic IDE);
//   "Trae.exe"         = international Trae.
// Detection must return the preferred product, not whichever process the
// CIM query happens to list first.
const TRAE_EXE_BASENAME_PRIORITY = ['trae solo cn.exe', 'trae cn.exe', 'trae.exe'];

export class TraeworkService {
  private crypto = getCryptoService();

  /**
   * Check whether a path points to this app's own executable.
   * The process query "Name LIKE 'Trae%'" also matches "Trae Account Manager.exe",
   * so every detection result must be filtered through this check.
   */
  private isSelfExePath(p: string): boolean {
    if (!p) return false;
    const lower = p.toLowerCase();
    if (process.execPath && lower === process.execPath.toLowerCase()) return true;
    return path.basename(lower) === 'trae account manager.exe';
  }

  /**
   * Pick the preferred Trae executable among detected candidates.
   * When several Trae products run at once (e.g. TraeWork CN alongside
   * TraeCode CN), prefer the one this manager is built for instead of an
   * arbitrary first CIM result.
   */
  private pickPreferredTraeExe(paths: string[]): string {
    const byBasename = new Map<string, string>();
    for (const p of paths) {
      byBasename.set(path.basename(p).toLowerCase(), p);
    }
    for (const preferred of TRAE_EXE_BASENAME_PRIORITY) {
      const hit = byBasename.get(preferred);
      if (hit) return hit;
    }
    return paths[0];
  }

  /**
   * Check if any Traework instance is currently running.
   */
  async isTraeworkRunning(): Promise<boolean> {
    try {
      const processNames = getTraeStoragePaths().map(p => p.processName);
      for (const name of processNames) {
        try {
          const { stdout } = await execAsync(`tasklist /FI "IMAGENAME eq ${name}" /FO CSV /NH`);
          if (stdout.includes(name)) {
            return true;
          }
        } catch {
          // Continue checking other names
        }
      }
      // Also try generic check
      try {
        const { stdout } = await execAsync('tasklist /FI "IMAGENAME eq TRAE*.exe" /FO CSV /NH');
        const lines = stdout.split('\n').filter(l => l.trim() && l.toLowerCase().includes('trae'));
        // Exclude our own process
        const isOtherTrae = lines.some(l => !l.includes('Trae Account Manager'));
        if (isOtherTrae) return true;
      } catch {
        // ignore
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Check if any Traework storage.json exists.
   */
  storageExists(): boolean {
    return findExistingTraeStorage().length > 0;
  }

  /**
   * List executable paths of currently running Trae processes.
   * Uses PowerShell CIM (WMIC is removed on recent Windows 11 builds).
   */
  async getRunningTraeExePaths(): Promise<string[]> {
    const paths: string[] = [];
    try {
      // Exclude our own "Trae Account Manager.exe" process, which also matches
      // "Name LIKE 'Trae%'" — matching it made auto-detect return this app's path.
      // WQL has no NOT LIKE, so the exclusion goes through Where-Object.
      const { stdout } = await execAsync(
        `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name LIKE 'Trae%'\\" | Where-Object { $_.Name -notlike '*Account Manager*' } | Select-Object -ExpandProperty ExecutablePath"`,
        { timeout: 15000 }
      );
      for (const line of stdout.split('\n')) {
        const p = line.trim();
        if (!p || !p.toLowerCase().endsWith('.exe') || !fs.existsSync(p)) continue;
        if (this.isSelfExePath(p)) continue;
        if (!paths.includes(p)) paths.push(p);
      }
    } catch (err) {
      logger.warn('Failed to enumerate running Trae processes:', err);
    }
    return paths;
  }

  /**
   * Detect the Trae executable path.
   * Priority: 1) running process path, 2) last known path from store,
   *           3) common install locations.
   * Returns null if not found.
   */
  async findTraeExePath(): Promise<string | null> {
    // 1. Try to get the path from a running Trae process. Multiple Trae
    //    products may run at once (TraeWork CN + TraeCode CN); pick the
    //    preferred product instead of the first CIM result.
    const runningPaths = await this.getRunningTraeExePaths();
    if (runningPaths.length > 0) {
      const preferred = this.pickPreferredTraeExe(runningPaths);
      logger.info(
        `Detected Trae exe from running process: ${preferred}` +
          (runningPaths.length > 1 ? ` (candidates: ${runningPaths.join(', ')})` : '')
      );
      store.set('lastKnownTraeExe', preferred);
      return preferred;
    }

    // 2. Last known path captured from a previous run. Reject stale values
    //    pointing at this app's own exe (cached by older buggy builds).
    const lastKnown = store.get('lastKnownTraeExe', '') as string;
    if (lastKnown && fs.existsSync(lastKnown) && !this.isSelfExePath(lastKnown)) {
      logger.info(`Using last known Trae exe path: ${lastKnown}`);
      return lastKnown;
    }

    // 3. Common install locations
    const roots = [
      process.env.LOCALAPPDATA,
      'D:\\',
      'C:\\',
      process.env.PROGRAMFILES,
      process.env['PROGRAMFILES(X86)'],
    ].filter((r): r is string => !!r);

    for (const root of roots) {
      for (const build of COMMON_TRAE_EXE_PATHS) {
        try {
          const candidate = build(root);
          if (fs.existsSync(candidate)) {
            logger.info(`Detected Trae exe from common location: ${candidate}`);
            store.set('lastKnownTraeExe', candidate);
            return candidate;
          }
        } catch {
          // ignore
        }
      }
    }

    return null;
  }

  /**
   * Close all running Trae processes (excluding our own app).
   * Returns the number of processes that were terminated.
   */
  async closeTraework(): Promise<number> {
    const processNames = getTraeStoragePaths().map(p => p.processName);
    let killed = 0;
    for (const name of processNames) {
      try {
        const { stdout } = await execAsync(`taskkill /IM "${name}" /F /T`);
        logger.info(`Closed Trae process ${name}: ${stdout.trim()}`);
        killed++;
      } catch {
        // No process with that name running - ignore
      }
    }
    // Also kill any other Trae*.exe processes (except our own app)
    try {
      const { stdout } = await execAsync('taskkill /IM "Trae.exe" /F /T');
      logger.info(`Closed Trae process Trae.exe: ${stdout.trim()}`);
      killed++;
    } catch {
      // ignore
    }
    return killed;
  }

  /**
   * Launch the Trae application.
   * If exePath is not provided, it is auto-detected (store cache → running
   * process → common locations).
   * Returns the exe path used, or null if Trae could not be found.
   */
  async launchTraework(exePath?: string): Promise<string | null> {
    const resolved = exePath && fs.existsSync(exePath) ? exePath : await this.findTraeExePath();
    if (!resolved) {
      logger.warn('Could not find Trae executable to launch');
      return null;
    }
    try {
      const child = spawn(resolved, [], { detached: true, stdio: 'ignore' });
      child.unref();
      logger.info(`Launched Trae: ${resolved}`);
      store.set('lastKnownTraeExe', resolved);
      return resolved;
    } catch (err) {
      logger.error('Failed to launch Trae:', err);
      return null;
    }
  }

  /**
   * Launch every given Trae executable (used to restart what was closed).
   * Returns the paths that were successfully launched.
   */
  async launchTraeworkPaths(exePaths: string[]): Promise<string[]> {
    const launched: string[] = [];
    for (const p of exePaths) {
      const result = await this.launchTraework(p);
      if (result) launched.push(result);
    }
    return launched;
  }

  /**
   * Read and parse a Traework storage.json file.
   */
  readStorageFromPath(storagePath: string): Record<string, unknown> | null {
    try {
      if (!fs.existsSync(storagePath)) {
        return null;
      }
      const content = fs.readFileSync(storagePath, 'utf-8');
      return JSON.parse(content);
    } catch (err) {
      logger.error('Failed to read Traework storage:', err);
      return null;
    }
  }

  /**
   * Read and parse all available Traework storage.json files.
   */
  readAllStorages(): Array<{ installName: string; storagePath: string; data: Record<string, unknown> }> {
    const results: Array<{ installName: string; storagePath: string; data: Record<string, unknown> }> = [];
    for (const inst of findExistingTraeStorage()) {
      const data = this.readStorageFromPath(inst.storagePath);
      if (data) {
        results.push({ installName: inst.name, storagePath: inst.storagePath, data });
      }
    }
    return results;
  }

  /**
   * Decrypt auth data from storage.
   */
  private decryptAuthData(storage: Record<string, unknown>): TraeAuthData | null {
    const tokenKey = 'iCubeAuthInfo://icube.cloudide';
    const encryptedToken = storage[tokenKey];

    if (!encryptedToken || typeof encryptedToken !== 'string') {
      return null;
    }

    // decryptTraeBlob already returns parsed JSON
    const decrypted = this.crypto.decryptTraeBlob(encryptedToken);
    if (!decrypted || typeof decrypted !== 'object') {
      return null;
    }

    return decrypted as TraeAuthData;
  }

  /**
   * Get the full decrypted auth blob currently present in any local Trae
   * installation. Used as a structural template when switching to an account
   * that has no stored blob: real Trae-written blobs contain fields (userRegion,
   * scope, loginScope, ...) that Trae requires to consider the session valid.
   * Picks the MOST COMPLETE blob across installations - one of them may hold a
   * minimal blob previously written by this app, which would be useless as a
   * template.
   */
  getRealAuthBlob(): TraeAuthData | null {
    let best: TraeAuthData | null = null;
    let bestScore = -1;
    for (const { data } of this.readAllStorages()) {
      const blob = this.decryptAuthData(data);
      if (!blob?.token) continue;
      const score = this.blobCompleteness(blob);
      if (score > bestScore) {
        best = blob;
        bestScore = score;
      }
    }
    return best;
  }

  /**
   * Detect local Traework accounts from all installations.
   * Returns a list of detected local accounts (may be multiple from different installations).
   * Prioritizes accounts with non-expired tokens.
   */
  detectLocalAccounts(): LocalAccountInfo[] {
    const storages = this.readAllStorages();
    const accounts: LocalAccountInfo[] = [];
    const seenUserIds = new Set<string>();

    for (const { installName, storagePath, data } of storages) {
      const authData = this.decryptAuthData(data);
      if (!authData || !authData.token) {
        continue;
      }

      const userId = authData.userId;
      if (userId && seenUserIds.has(userId)) {
        // Already have this user from another install - skip duplicate.
        // Prefer: non-expired token, then the more complete blob (one install
        // may hold a minimal blob previously written by this app).
        const existing = accounts.find(a => a.userId === userId);
        if (existing) {
          const existingExpired = existing.expiredAt ? new Date(existing.expiredAt) < new Date() : true;
          const newExpired = authData.expiredAt ? new Date(authData.expiredAt) < new Date() : false;
          const betterBlob = this.blobCompleteness(authData) > this.blobCompleteness(existing.authBlob);
          if ((existingExpired && !newExpired) || (betterBlob && existingExpired === newExpired)) {
            const idx = accounts.indexOf(existing);
            accounts[idx] = this.buildLocalAccountInfo(installName, storagePath, authData);
          }
        }
        continue;
      }
      if (userId) {
        seenUserIds.add(userId);
      }

      accounts.push(this.buildLocalAccountInfo(installName, storagePath, authData));
    }

    return accounts;
  }

  /**
   * Score how structurally complete an auth blob is. Trae-written blobs carry
   * userRegion / scope / loginScope etc.; minimal blobs written by older
   * versions of this app do not.
   */
  private blobCompleteness(blob?: TraeAuthData | null): number {
    if (!blob) return -1;
    let score = 0;
    if (blob.userRegion) score += 2;
    if (blob.account?.scope) score += 2;
    if (blob.account?.loginScope) score += 1;
    if (blob.refreshExpiredAt) score += 1;
    if (blob.account?.userTag) score += 1;
    return score;
  }

  private buildLocalAccountInfo(installName: string, storagePath: string, authData: TraeAuthData): LocalAccountInfo {
    const nickname = authData.account?.username || authData.account?.nickname;
    const email = authData.account?.email;
    const avatarUrl = authData.account?.avatar_url;
    const phone = authData.account?.nonPlainTextMobile;

    return {
      exists: true,
      nickname,
      email,
      userId: authData.userId,
      avatarUrl,
      phone,
      installName,
      storagePath,
      token: authData.token,
      refreshToken: authData.refreshToken,
      host: authData.host || 'https://api.trae.cn',
      expiredAt: authData.expiredAt,
      userRegion: authData.userRegion?.region || authData.userRegion?._aiRegion,
      accountInfo: authData.account,
      authBlob: authData,
    };
  }

  /**
   * Detect and extract the currently logged-in local account info (legacy single account).
   * @deprecated Use detectLocalAccounts() instead for multi-installation support.
   */
  detectLocalAccount(): LocalAccountInfo {
    const accounts = this.detectLocalAccounts();
    if (accounts.length === 0) {
      return { exists: false };
    }
    // Return the first found account (prefer non-expired)
    const valid = accounts.find(a => !a.expiredAt || new Date(a.expiredAt) > new Date());
    return valid || accounts[0];
  }

  /**
   * Get decrypted token from a specific storage path.
   */
  getLocalTokenFromPath(storagePath: string): string | null {
    const storage = this.readStorageFromPath(storagePath);
    if (!storage) return null;

    const authData = this.decryptAuthData(storage);
    return authData?.token || null;
  }

  /**
   * Extract the real Trae device ID from storage.json.
   *
   * The real Trae app registers a device and stores it under the key
   * `iCubeAuthInfo://icube-dc:{deviceId}`. The checkin claim API rejects
   * random device IDs with code 9074 ("操作太过频繁"), so we must reuse the
   * device ID that Trae itself registered for this machine.
   *
   * Returns the first device ID found across all installed Trae storages,
   * or null if none is present.
   */
  getTraeDeviceId(): string | null {
    for (const { data } of this.readAllStorages()) {
      const deviceKeys = Object.keys(data).filter(k => k.startsWith('iCubeAuthInfo://icube-dc:'));
      for (const key of deviceKeys) {
        const deviceId = key.split('icube-dc:')[1];
        if (deviceId && deviceId.trim()) {
          return deviceId.trim();
        }
      }
    }
    return null;
  }

  /**
   * Get the raw encrypted token from first available storage (legacy).
   * @deprecated Use getLocalTokenFromPath() for specific path.
   */
  getLocalToken(): string | null {
    const storages = this.readAllStorages();
    for (const { data } of storages) {
      const authData = this.decryptAuthData(data);
      if (authData?.token) {
        return authData.token;
      }
    }
    return null;
  }

  /**
   * Switch Traework to use a different account token.
   * This atomically writes the new encrypted token to storage.json.
   */
  async switchAccount(
    newAuthData: TraeAuthData,
    storagePath?: string,
    options?: { allowRunning?: boolean }
  ): Promise<{ success: boolean; backupCreated: boolean; storagePath: string }> {
    // Check if Traework is running (unless auto-managed, where we close it first)
    if (!options?.allowRunning) {
      const running = await this.isTraeworkRunning();
      if (running) {
        throw new Error('请先关闭 Trae 再切换账号');
      }
    }

    // Determine which storage to modify
    let targetStorage = storagePath;
    let targetBackup: string | undefined;

    if (targetStorage) {
      // Find backup path
      const allPaths = getTraeStoragePaths();
      const found = allPaths.find(p => p.storagePath === targetStorage);
      targetBackup = found?.backupPath;
    } else {
      // Use first existing storage
      const existing = findExistingTraeStorage();
      if (existing.length === 0) {
        throw new Error('未找到 Trae 存储文件，请先运行 Trae 并登录');
      }
      targetStorage = existing[0].storagePath;
      targetBackup = existing[0].backupPath;
    }

    const storage = this.readStorageFromPath(targetStorage);
    if (!storage) {
      throw new Error('无法读取 Trae 存储文件');
    }

    const tokenKey = 'iCubeAuthInfo://icube.cloudide';

    // Encrypt the new auth data in Trae-compatible format
    const encrypted = this.crypto.encryptTraeBlob(newAuthData);

    // Create a copy of storage with the new token
    const newStorage = { ...storage };
    newStorage[tokenKey] = encrypted;

    // Reset server data to force refresh
    const serverDataKey = 'iCubeServerData://icube.cloudide';
    if (serverDataKey in newStorage) {
      delete newStorage[serverDataKey];
    }

    try {
      if (targetBackup) {
        writeJsonAtomic(targetStorage, newStorage, targetBackup);
      } else {
        writeJsonAtomic(targetStorage, newStorage);
      }

      logger.info('Successfully switched Traework account');
      return { success: true, backupCreated: true, storagePath: targetStorage };
    } catch (err) {
      logger.error('Failed to write Traework storage:', err);

      // Attempt restore from backup
      if (targetBackup && restoreFromBackup(targetStorage, targetBackup)) {
        logger.info('Restored Traework storage from backup');
      }

      throw new Error(`切换账号失败: ${(err as Error).message}`);
    }
  }
}

// Singleton
let traeworkServiceInstance: TraeworkService | null = null;

export function getTraeworkService(): TraeworkService {
  if (!traeworkServiceInstance) {
    traeworkServiceInstance = new TraeworkService();
  }
  return traeworkServiceInstance;
}
