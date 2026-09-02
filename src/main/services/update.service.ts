import { app, net, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import type { ReadableStream as NodeWebReadableStream } from 'stream/web';
import { logger } from '../utils/logger';
import { getMainWindow } from '../window';
import { IPC_CHANNELS } from '../../shared/types';
import type { UpdateAsset, UpdateInfo, UpdateProgress } from '../../shared/types';

const GITHUB_REPO = 'zamatewi-cell/traesolocn_account_manager';
const RELEASES_LATEST_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const USER_AGENT = 'trae-account-manager-updater';

// GitHub is unreachable from many mainland-CN networks. jsDelivr CDN mirrors
// the repo's package.json (cached ~hours) and works without a proxy, so the
// version check falls back to it when the GitHub API times out.
const VERSION_CHECK_FALLBACKS = [
  `https://cdn.jsdelivr.net/gh/${GITHUB_REPO}@main/package.json`,
  `https://fastly.jsdelivr.net/gh/${GITHUB_REPO}@main/package.json`,
  `https://gcore.jsdelivr.net/gh/${GITHUB_REPO}@main/package.json`,
];

// Release-asset download mirrors (prefix + full github URL). '' = direct.
// Blocked mirrors usually answer with an HTML error page - rejected by the
// content-type / size sanity checks in downloadUpdate.
const DOWNLOAD_MIRROR_PREFIXES = ['', 'https://gh-proxy.com/', 'https://ghfast.top/'];

function installerAssetName(version: string): string {
  return `Trae-Account-Manager-Setup-${version}.exe`;
}

function normalizeVersion(v: string): string {
  return (v || '').trim().replace(/^v/i, '');
}

function compareVersions(a: string, b: string): number {
  const pa = normalizeVersion(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = normalizeVersion(b).split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

interface GithubAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface GithubRelease {
  tag_name: string;
  html_url: string;
  body: string;
  assets: GithubAsset[];
}

export class UpdateService {
  private approvedAsset: UpdateAsset | null = null;
  private downloadedInstallerPath: string | null = null;

  /**
   * Check GitHub Releases for a newer version than the running app.
   * Falls back to jsDelivr-mirrored package.json when GitHub is unreachable
   * (typical on mainland-CN networks without a proxy).
   */
  async checkForUpdates(): Promise<UpdateInfo> {
    const currentVersion = app.getVersion();
    this.approvedAsset = null;
    this.downloadedInstallerPath = null;

    try {
      const info = await this.checkViaGithubApi(currentVersion);
      this.approvedAsset = info.updateAvailable ? info.asset : null;
      return info;
    } catch (err) {
      logger.warn('GitHub update check failed, trying jsDelivr mirror:', (err as Error).message);
    }

    const info = await this.checkViaCdnMirror(currentVersion);
    this.approvedAsset = info.updateAvailable ? info.asset : null;
    return info;
  }

  private async checkViaGithubApi(currentVersion: string): Promise<UpdateInfo> {
    // Cache-busting query + cache:'no-store': a version check made right
    // after a release must never be served from a cached response.
    const res = await net.fetch(`${RELEASES_LATEST_API}?_=${Date.now()}`, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/vnd.github+json',
      },
      signal: AbortSignal.timeout(15000),
      cache: 'no-store',
    });
    if (!res.ok) {
      throw new Error(`GitHub API HTTP ${res.status}`);
    }
    const release = (await res.json()) as GithubRelease;

    const latestVersion = normalizeVersion(release.tag_name || '');
    const expectedName = installerAssetName(latestVersion);
    const installerAsset = (release.assets || []).find(a => a.name === expectedName);
    const manifestAsset = (release.assets || []).find(a => a.name === 'latest.yml');
    let verifiedAsset: UpdateAsset | null = null;

    if (compareVersions(latestVersion, currentVersion) > 0 && installerAsset && manifestAsset) {
      try {
        const manifest = await this.fetchReleaseManifest(manifestAsset.browser_download_url, expectedName);
        verifiedAsset = {
          name: installerAsset.name,
          url: installerAsset.browser_download_url,
          size: installerAsset.size || manifest.size,
          sha512: manifest.sha512,
        };
      } catch (err) {
        logger.warn('Release installer has no usable checksum manifest; automatic download disabled:', (err as Error).message);
      }
    }

    const info: UpdateInfo = {
      updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
      currentVersion,
      latestVersion,
      releaseUrl: release.html_url || `https://github.com/${GITHUB_REPO}/releases`,
      releaseNotes: release.body || '',
      asset: verifiedAsset,
    };
    logger.info(
      `Update check: current=${currentVersion} latest=${latestVersion} available=${info.updateAvailable}`
    );
    return info;
  }

  private async checkViaCdnMirror(currentVersion: string): Promise<UpdateInfo> {
    let lastError = '无法访问 GitHub 更新源';
    for (const cdnUrl of VERSION_CHECK_FALLBACKS) {
      try {
        // jsDelivr serves package.json with Cache-Control: max-age=604800,
        // and Electron's net.fetch reuses its HTTP disk cache without
        // revalidation. A version check issued right after a release would
        // therefore keep returning the PREVIOUS version for days (observed:
        // v1.2.0 published + CDN purged, app still saw 1.1.9). A unique URL
        // per check busts every cache layer; cache:'no-store' is belt and
        // braces in case Electron honors it.
        const res = await net.fetch(`${cdnUrl}?_=${Date.now()}`, {
          headers: { 'User-Agent': USER_AGENT },
          signal: AbortSignal.timeout(10000),
          cache: 'no-store',
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const pkg = (await res.json()) as { version?: string };
        const latestVersion = normalizeVersion(pkg.version || '');
        if (!latestVersion) {
          throw new Error('镜像返回的版本号为空');
        }
        const name = installerAssetName(latestVersion);
        let verifiedAsset: UpdateAsset | null = null;
        if (compareVersions(latestVersion, currentVersion) > 0) {
          const releaseBase = `https://github.com/${GITHUB_REPO}/releases/download/v${latestVersion}`;
          try {
            const manifest = await this.fetchReleaseManifest(`${releaseBase}/latest.yml`, name);
            verifiedAsset = {
              name,
              url: `${releaseBase}/${name}`,
              size: manifest.size,
              sha512: manifest.sha512,
            };
          } catch (err) {
            logger.warn(`Release v${latestVersion} has no usable latest.yml; automatic download disabled:`, (err as Error).message);
          }
        }
        const info: UpdateInfo = {
          // The CDN mirrors the source branch, which may be bumped before a
          // release exists. Only a matching checksum manifest confirms
          // that this version is actually publishable to users.
          updateAvailable: compareVersions(latestVersion, currentVersion) > 0 && verifiedAsset !== null,
          currentVersion,
          latestVersion,
          releaseUrl: `https://github.com/${GITHUB_REPO}/releases/tag/v${latestVersion}`,
          releaseNotes: '',
          asset: verifiedAsset,
        };
        logger.info(
          `Update check via ${new URL(cdnUrl).host}: current=${currentVersion} latest=${latestVersion} available=${info.updateAvailable}`
        );
        return info;
      } catch (err) {
        lastError = (err as Error).message;
        logger.warn(`Version check via ${cdnUrl} failed:`, lastError);
      }
    }
    throw new Error(`检查更新失败（GitHub 与镜像均不可达）: ${lastError}`);
  }

  private async fetchReleaseManifest(
    manifestUrl: string,
    expectedInstallerName: string
  ): Promise<{ sha512: string; size: number }> {
    const separator = manifestUrl.includes('?') ? '&' : '?';
    const res = await net.fetch(`${manifestUrl}${separator}_=${Date.now()}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(15000),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`latest.yml HTTP ${res.status}`);
    const text = await res.text();
    const pathMatch = text.match(/^path:\s*['"]?([^'"\r\n]+)['"]?\s*$/m);
    const shaMatch = text.match(/^sha512:\s*([^\s]+)\s*$/m);
    const sizeMatch = text.match(/^\s+size:\s*(\d+)\s*$/m);
    if (!pathMatch || pathMatch[1].trim() !== expectedInstallerName) {
      throw new Error('latest.yml 安装包名称不匹配');
    }
    if (!shaMatch || !/^[A-Za-z0-9+/]+={0,2}$/.test(shaMatch[1])) {
      throw new Error('latest.yml 缺少有效 SHA-512');
    }
    return { sha512: shaMatch[1], size: Number(sizeMatch?.[1] || 0) };
  }

  /**
   * Download the installer asset to the temp directory, reporting progress to
   * the renderer via UPDATE_DOWNLOAD_PROGRESS events.
   * Tries the direct GitHub URL first, then CN-friendly mirrors.
   * Returns the local path of the downloaded installer.
   */
  async downloadUpdate(assetUrl: string, assetName: string): Promise<string> {
    const approved = this.approvedAsset;
    if (!approved || approved.url !== assetUrl || approved.name !== assetName) {
      throw new Error('更新信息已失效，请重新检查更新');
    }
    if (path.basename(assetName) !== assetName || !/^Trae-Account-Manager-Setup-[0-9]+(?:\.[0-9]+){2}\.exe$/.test(assetName)) {
      throw new Error('安装包文件名无效');
    }
    const expectedPrefix = `https://github.com/${GITHUB_REPO}/releases/download/`;
    if (!assetUrl.startsWith(expectedPrefix)) {
      throw new Error('安装包来源无效');
    }

    const targetDir = path.join(app.getPath('temp'), 'trae-account-manager-update');
    fs.mkdirSync(targetDir, { recursive: true });
    const targetPath = path.join(targetDir, assetName);

    let lastError = '下载失败';
    for (const mirror of DOWNLOAD_MIRROR_PREFIXES) {
      const url = `${mirror}${assetUrl}`;
      try {
        await this.downloadFrom(url, targetPath, approved);
        this.downloadedInstallerPath = path.resolve(targetPath);
        logger.info(`Update installer downloaded from ${mirror || 'direct'}: ${targetPath}`);
        return targetPath;
      } catch (err) {
        try { fs.unlinkSync(targetPath); } catch { /* no partial file */ }
        lastError = (err as Error).message;
        logger.warn(`Update download from ${url} failed:`, lastError);
      }
    }
    throw new Error(`下载失败（直连与镜像均不可用）: ${lastError}`);
  }

  private async downloadFrom(url: string, targetPath: string, expected: UpdateAsset): Promise<void> {
    const res = await net.fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(10 * 60 * 1000),
    });
    if (!res.ok || !res.body) {
      throw new Error(`HTTP ${res.status}`);
    }

    // A blocked/proxied host often answers 200 with an HTML error page
    // instead of the binary. Reject those before writing anything.
    const contentType = res.headers.get('content-type') || '';
    const total = parseInt(res.headers.get('content-length') || '0', 10);
    if (contentType.includes('text/html')) {
      throw new Error('镜像返回了错误页面 (text/html)');
    }
    if (total > 0 && total < 1024 * 1024) {
      throw new Error(`响应过小 (${total} bytes)，疑似错误页面`);
    }

    let received = 0;
    let lastSent = 0;
    const sendProgress = (force = false) => {
      const now = Date.now();
      if (!force && now - lastSent < 200) return;
      lastSent = now;
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        const progress: UpdateProgress = { received, total };
        win.webContents.send(IPC_CHANNELS.UPDATE_DOWNLOAD_PROGRESS, progress);
      }
    };

    const nodeStream = Readable.fromWeb(res.body as unknown as NodeWebReadableStream<Uint8Array>);
    nodeStream.on('data', (chunk: Buffer) => {
      received += chunk.length;
      sendProgress();
    });
    await pipeline(nodeStream, fs.createWriteStream(targetPath));
    sendProgress(true);

    if (received < 1024 * 1024) {
      throw new Error(`下载数据过小 (${received} bytes)，疑似错误页面`);
    }
    if (expected.size > 0 && received !== expected.size) {
      throw new Error(`安装包大小不匹配（期望 ${expected.size}，实际 ${received}）`);
    }
    const digest = await this.sha512File(targetPath);
    if (digest !== expected.sha512) {
      throw new Error('安装包 SHA-512 校验失败');
    }
  }

  private sha512File(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash('sha512');
      const input = fs.createReadStream(filePath);
      input.on('data', chunk => hash.update(chunk));
      input.on('error', reject);
      input.on('end', () => resolve(hash.digest('base64')));
    });
  }

  /**
   * Launch the downloaded installer and quit this app so the installer can
   * overwrite its files.
   */
  async installUpdate(installerPath: string): Promise<boolean> {
    const resolvedPath = installerPath ? path.resolve(installerPath) : '';
    const targetDir = path.resolve(path.join(app.getPath('temp'), 'trae-account-manager-update'));
    if (
      !resolvedPath ||
      resolvedPath !== this.downloadedInstallerPath ||
      path.dirname(resolvedPath) !== targetDir ||
      !fs.existsSync(resolvedPath)
    ) {
      throw new Error('安装包不存在或已被删除');
    }
    const child = spawn(resolvedPath, [], { detached: true, stdio: 'ignore' });
    child.unref();
    logger.info(`Update installer launched, quitting app: ${resolvedPath}`);
    // Give the installer a moment to come up before we exit
    setTimeout(() => app.quit(), 1000);
    return true;
  }

  /**
   * Open the release page in the default browser (fallback when no installer
   * asset is attached to the release).
   */
  openReleasePage(releaseUrl: string): void {
    shell.openExternal(releaseUrl);
  }
}

// Singleton
let updateServiceInstance: UpdateService | null = null;

export function getUpdateService(): UpdateService {
  if (!updateServiceInstance) {
    updateServiceInstance = new UpdateService();
  }
  return updateServiceInstance;
}
