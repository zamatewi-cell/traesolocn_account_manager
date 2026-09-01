import fs from 'fs';
import path from 'path';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { findExistingTraeStorage, findPreferredTraeStorage, getTraeStoragePaths } from '../utils/paths';
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
   * Reduce a list of exe paths to the preferred product's executable only.
   * Used before relaunching after a switch so only TRAE SOLO CN restarts.
   */
  filterPreferredExe(paths: string[]): string[] {
    const preferred = this.pickPreferredTraeExe(paths);
    return preferred ? [preferred] : [];
  }

  /**
   * Check if the PREFERRED Trae product is currently running.
   * Only TRAE SOLO CN counts: a running Trae CN / international Trae must NOT
   * block account switching, because switching never touches those products.
   */
  async isTraeworkRunning(): Promise<boolean> {
    const name = findPreferredTraeStorage()?.processName ?? 'TRAE SOLO CN.exe';
    try {
      const { stdout } = await execAsync(`tasklist /FI "IMAGENAME eq ${name}" /FO CSV /NH`);
      return stdout.toLowerCase().includes(name.toLowerCase());
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
   * Find Trae install locations from the Windows Uninstall registry.
   * Covers custom install directories that neither the running-process scan
   * nor the common-path templates know about (typical on other machines).
   */
  private async findTraeExeFromRegistry(): Promise<string[]> {
    const uninstallRoots = [
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
      'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
      'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    ];
    const found: string[] = [];

    for (const root of uninstallRoots) {
      let stdout = '';
      try {
        // eslint-disable-next-line no-await-in-loop
        const result = await execAsync(`reg query "${root}" /s`, { timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
        stdout = result.stdout;
      } catch {
        // Key missing or reg.exe unavailable - try the next hive
        continue;
      }

      // Parse the key/value dump into per-application blocks
      const blocks: Array<{ displayName: string; displayIcon: string; installLocation: string }> = [];
      let current: { displayName: string; displayIcon: string; installLocation: string } | null = null;
      for (const line of stdout.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (/^HKEY_/.test(trimmed)) {
          if (current) blocks.push(current);
          current = { displayName: '', displayIcon: '', installLocation: '' };
          continue;
        }
        const valueMatch = trimmed.match(/^(DisplayName|DisplayIcon|InstallLocation)\s+REG_SZ\s+(.*)$/i);
        if (valueMatch && current) {
          const key = valueMatch[1].toLowerCase();
          const val = valueMatch[2].trim();
          if (key === 'displayname') current.displayName = val;
          else if (key === 'displayicon') current.displayIcon = val;
          else if (key === 'installlocation') current.installLocation = val;
        }
      }
      if (current) blocks.push(current);

      for (const app of blocks) {
        const name = app.displayName || '';
        if (!/trae/i.test(name)) continue;
        if (/account\s*manager/i.test(name)) continue;

        // DisplayIcon usually points straight at the exe (may carry a ",0" icon index)
        if (app.displayIcon) {
          const exe = app.displayIcon.replace(/,\d+$/, '').replace(/^"|"$/g, '');
          if (fs.existsSync(exe) && !this.isSelfExePath(exe)) {
            found.push(exe);
            continue;
          }
        }
        if (app.installLocation) {
          const dir = app.installLocation.replace(/\\$/, '');
          for (const preferred of TRAE_EXE_BASENAME_PRIORITY) {
            const candidate = path.join(dir, preferred);
            if (fs.existsSync(candidate) && !this.isSelfExePath(candidate)) {
              found.push(candidate);
              break;
            }
          }
        }
      }
    }

    return found;
  }

  /**
   * Find the Trae executable path.
   * Detection chain: running process → cached path → common locations → registry.
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

    // 4. Uninstall registry (custom install directories on other machines)
    try {
      const registryPaths = await this.findTraeExeFromRegistry();
      if (registryPaths.length > 0) {
        const preferred = this.pickPreferredTraeExe(registryPaths);
        logger.info(`Detected Trae exe from registry: ${preferred}`);
        store.set('lastKnownTraeExe', preferred);
        return preferred;
      }
    } catch (err) {
      logger.warn('Registry-based Trae detection failed:', (err as Error).message);
    }

    return null;
  }

  /**
   * Close the PREFERRED Trae product's processes only.
   * Trae CN / international Trae sessions are independent IDEs - killing them
   * during an account switch (and not restoring them) destroys the user's
   * work, so they must never be terminated here.
   * Returns the number of taskkill commands that found processes.
   */
  async closeTraework(): Promise<number> {
    const name = findPreferredTraeStorage()?.processName ?? 'TRAE SOLO CN.exe';
    try {
      const { stdout } = await execAsync(`taskkill /IM "${name}" /F /T`);
      logger.info(`Closed Trae process ${name}: ${stdout.trim()}`);
      return 1;
    } catch {
      // No process with that name running - ignore
      return 0;
    }
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
   * Detect account sessions preserved in storage.json.bak backups.
   * Every switch backs up the live storage before overwriting it, so each
   * .bak holds the complete session of the account that was switched AWAY
   * from - often the only surviving copy of that account's client-issued
   * refresh token (the live storage only ever holds one account). Used as a
   * fallback credential source for rows whose own credentials were lost or
   * damaged, e.g. by the cross-contamination cleanup.
   */
  detectLocalBackupAccounts(): LocalAccountInfo[] {
    const accounts: LocalAccountInfo[] = [];
    const seenUserIds = new Set<string>();

    for (const inst of findExistingTraeStorage()) {
      if (!fs.existsSync(inst.backupPath)) continue;
      const data = this.readStorageFromPath(inst.backupPath);
      if (!data) continue;

      const authData = this.decryptAuthData(data);
      if (!authData || !authData.token) continue;

      const userId = authData.userId;
      if (userId && seenUserIds.has(userId)) {
        // Same user in several backups: keep the freshest session.
        const existing = accounts.find(a => a.userId === userId);
        if (existing) {
          const existingExp = existing.expiredAt ? new Date(existing.expiredAt).getTime() : 0;
          const newExp = authData.expiredAt ? new Date(authData.expiredAt).getTime() : 0;
          if (newExp > existingExp) {
            const idx = accounts.indexOf(existing);
            accounts[idx] = this.buildLocalAccountInfo(`${inst.name} (backup)`, inst.backupPath, authData);
          }
        }
        continue;
      }
      if (userId) {
        seenUserIds.add(userId);
      }

      accounts.push(this.buildLocalAccountInfo(`${inst.name} (backup)`, inst.backupPath, authData));
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
