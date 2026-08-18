import { app, net, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import type { ReadableStream as NodeWebReadableStream } from 'stream/web';
import { logger } from '../utils/logger';
import { getMainWindow } from '../window';
import { IPC_CHANNELS } from '../../shared/types';
import type { UpdateInfo, UpdateProgress } from '../../shared/types';

const GITHUB_REPO = 'zamatewi-cell/traesolocn_account_manager';
const RELEASES_LATEST_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const USER_AGENT = 'trae-account-manager-updater';

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
  /**
   * Check GitHub Releases for a newer version than the running app.
   */
  async checkForUpdates(): Promise<UpdateInfo> {
    const currentVersion = app.getVersion();

    const res = await net.fetch(RELEASES_LATEST_API, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/vnd.github+json',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      throw new Error(`GitHub API HTTP ${res.status}`);
    }
    const release = (await res.json()) as GithubRelease;

    const latestVersion = normalizeVersion(release.tag_name || '');
    const installerAsset = (release.assets || []).find(a =>
      a.name && a.name.toLowerCase().endsWith('.exe')
    );

    const info: UpdateInfo = {
      updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
      currentVersion,
      latestVersion,
      releaseUrl: release.html_url || `https://github.com/${GITHUB_REPO}/releases`,
      releaseNotes: release.body || '',
      asset: installerAsset
        ? { name: installerAsset.name, url: installerAsset.browser_download_url, size: installerAsset.size }
        : null,
    };
    logger.info(
      `Update check: current=${currentVersion} latest=${latestVersion} available=${info.updateAvailable}`
    );
    return info;
  }

  /**
   * Download the installer asset to the temp directory, reporting progress to
   * the renderer via UPDATE_DOWNLOAD_PROGRESS events.
   * Returns the local path of the downloaded installer.
   */
  async downloadUpdate(assetUrl: string, assetName: string): Promise<string> {
    const res = await net.fetch(assetUrl, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(10 * 60 * 1000),
    });
    if (!res.ok || !res.body) {
      throw new Error(`下载失败: HTTP ${res.status}`);
    }

    const total = parseInt(res.headers.get('content-length') || '0', 10);
    const targetDir = path.join(app.getPath('temp'), 'trae-account-manager-update');
    fs.mkdirSync(targetDir, { recursive: true });
    const targetPath = path.join(targetDir, assetName);

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

    logger.info(`Update installer downloaded: ${targetPath} (${received} bytes)`);
    return targetPath;
  }

  /**
   * Launch the downloaded installer and quit this app so the installer can
   * overwrite its files.
   */
  async installUpdate(installerPath: string): Promise<boolean> {
    if (!installerPath || !fs.existsSync(installerPath)) {
      throw new Error('安装包不存在或已被删除');
    }
    const child = spawn(installerPath, [], { detached: true, stdio: 'ignore' });
    child.unref();
    logger.info(`Update installer launched, quitting app: ${installerPath}`);
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
