import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron';
import path from 'path';
import { logger } from './utils/logger';

/**
 * System tray module.
 *
 * - One Tray instance per app run.
 * - Clicking the tray icon (or "Open" in its context menu) shows the main window.
 *   If the window has been destroyed we recreate it via the createFn callback.
 * - Right-click context menu also offers "Quit", which sets isQuitting=true so
 *   the intercepted window close event lets the OS destroy the window this time.
 */

let tray: Tray | null = null;
let isQuitting = false;

/** Set when the user explicitly chose Quit from the tray or app menu. */
export function setQuitting(flag: boolean): void {
  isQuitting = flag;
}

/** True when the app is performing an explicit shutdown. */
export function isAppQuitting(): boolean {
  return isQuitting;
}

/**
 * Find the tray icon in both dev and packaged builds.
 * - dev:      <project>/resources/icon.ico
 * - packaged: <resourcesDir>/icon.ico  (set via electron-builder extraResources)
 */
function getIconPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'icon.ico');
  }
  // In dev `__dirname` is <project>/dist/main, so go up two levels.
  return path.join(__dirname, '..', '..', 'resources', 'icon.ico');
}

function loadTrayImage(): Electron.NativeImage {
  try {
    const p = getIconPath();
    const img = nativeImage.createFromPath(p);
    if (img.isEmpty()) {
      logger.warn(`[DIAG] tray icon empty at ${p}, falling back to empty image`);
      return nativeImage.createEmpty();
    }
    return img;
  } catch (err) {
    logger.warn('[DIAG] tray icon load failed:', (err as Error).message);
    return nativeImage.createEmpty();
  }
}

interface TrayDeps {
  getMainWindow: () => BrowserWindow | null;
  createMainWindow: () => BrowserWindow;
}

/**
 * Show the main window; if the BrowserWindow has been destroyed, recreate it.
 * Uses the same always-on-top trick from window.ts to force foreground.
 */
function showOrCreateMain({ getMainWindow, createMainWindow }: TrayDeps): void {
  let win = getMainWindow();
  if (!win || win.isDestroyed()) {
    createMainWindow();
    return;
  }
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.setAlwaysOnTop(true, 'screen-saver');
  win.moveTop();
  win.focus();
  setTimeout(() => {
    if (!win.isDestroyed()) win.setAlwaysOnTop(false);
  }, 1000);
  logger.info('[DIAG] tray clicked -> window shown+raised');
}

export function createTray(deps: TrayDeps): Tray | null {
  if (tray) return tray;

  const image = loadTrayImage();
  try {
    tray = new Tray(image);
  } catch (err) {
    // Some environments (CI without a display server, sandboxed Linux) cannot
    // create a Tray. We don't want the whole app to refuse to start for that.
    logger.error('[DIAG] Tray() construction failed:', (err as Error).message);
    tray = null;
    return null;
  }

  tray.setToolTip('Trae Account Manager');

  const menu = Menu.buildFromTemplate([
    {
      label: '打开主界面',
      click: () => showOrCreateMain(deps),
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);

  // On Windows left-click on a tray that has a context menu also pops the menu,
  // so we leave single-click to the menu and use double-click as the shortcut
  // for "open main window". On macOS / Linux left-click is the natural click,
  // so we wire it directly.
  if (process.platform === 'win32') {
    tray.on('double-click', () => showOrCreateMain(deps));
  } else {
    tray.on('click', () => showOrCreateMain(deps));
  }

  logger.info('[DIAG] system tray created');
  return tray;
}

export function destroyTray(): void {
  if (tray && !tray.isDestroyed()) {
    try {
      tray.destroy();
    } catch (err) {
      logger.warn('[DIAG] tray destroy failed:', (err as Error).message);
    }
  }
  tray = null;
}
