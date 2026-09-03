import { BrowserWindow, shell } from 'electron';
import path from 'path';
import { logger } from './utils/logger';
import { isAppQuitting } from './tray';

const isDev = process.env.NODE_ENV === 'development';

let mainWindow: BrowserWindow | null = null;

/**
 * Show the window and force it to the foreground so it is not hidden
 * behind other windows (a common cause of "app is running but no window
 * appears").
 */
function showAndFocus(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  win.show();
  // Briefly raise above other windows so the user sees it, then restore
  // normal Z-order so it behaves like a normal app afterwards.
  win.setAlwaysOnTop(true, 'screen-saver');
  win.moveTop();
  win.focus();
  setTimeout(() => {
    if (!win.isDestroyed()) {
      win.setAlwaysOnTop(false);
    }
  }, 1000);
  logger.info(`[DIAG] window shown+raised, visible=${win.isVisible()} focused=${win.isFocused()}`);
}

export function createMainWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
    return mainWindow;
  }

  logger.info('[DIAG] Creating main window...');

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 900,
    minHeight: 600,
    frame: false, // Frameless for custom titlebar. No titleBarStyle/Overlay:
    // on Windows, 'hidden' activates the window-controls-overlay code path
    // and any overlay makes Windows draw its own light-themed controls over
    // the top-right corner. The HTML TitleBar handles min/max/close itself.
    backgroundColor: '#0d0f1d',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
  });

  const win = mainWindow;

  // Capture renderer console messages so we can diagnose blank-window issues
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const lv = ['DEBUG', 'INFO', 'WARN', 'ERROR'][level] || 'LOG';
    logger.info(`[RENDERER:${lv}] ${message} (${sourceId}:${line})`);
  });

  win.webContents.on('did-finish-load', () => {
    logger.info('[DIAG] renderer did-finish-load');
    // Verify React actually mounted by inspecting the DOM after a short delay
    setTimeout(async () => {
      try {
        const result = await win.webContents.executeJavaScript(
          `(() => {
            const root = document.getElementById('root');
            const html = document.documentElement ? document.documentElement.outerHTML.slice(0, 200) : '';
            return JSON.stringify({
              rootExists: !!root,
              rootChildren: root ? root.children.length : -1,
              rootHtml: root ? root.innerHTML.slice(0, 300) : '',
              bodyText: document.body ? document.body.innerText.slice(0, 200) : '',
              readyState: document.readyState,
            });
          })()`
        );
        logger.info('[DIAG] DOM check after load:', result);
      } catch (err) {
        logger.error('[DIAG] DOM check failed:', (err as Error).message);
      }
    }, 2000);
  });

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    logger.error(`[DIAG] renderer did-fail-load code=${errorCode} desc=${errorDescription} url=${validatedURL}`);
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    logger.error(`[DIAG] renderer process gone: ${details.reason} exitCode=${details.exitCode}`);
  });

  // Load the app
  if (isDev) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }

  // Show window when ready
  win.once('ready-to-show', () => {
    logger.info('[DIAG] ready-to-show fired, showing window');
    showAndFocus(win);
  });

  // Fallback: force-show the window even if ready-to-show never fires
  // (e.g. renderer is slow or failed to paint). Prevents "process running
  // but no window visible" situations.
  setTimeout(() => {
    if (win && !win.isDestroyed() && !win.isVisible()) {
      logger.warn('[DIAG] Fallback: forcing window to show');
      showAndFocus(win);
      logger.info(`[DIAG] fallback window shown, visible=${win.isVisible()}`);
    } else if (win && !win.isDestroyed()) {
      logger.info(`[DIAG] window already visible after 3s, visible=${win.isVisible()}`);
    }
  }, 3000);

  // External links open in browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('show', () => {
    logger.info('[DIAG] window show event fired');
  });

  // Intercept window close so clicking the × (or invoking window:close via IPC)
  // hides the UI to the system tray instead of killing the process. The actual
  // shutdown path goes through the tray's "Quit" item, which sets
  // isAppQuitting() = true and lets the close pass through.
  win.on('close', (event) => {
    if (isAppQuitting()) {
      logger.info('[DIAG] window close during shutdown -> allowing destroy');
      return;
    }
    event.preventDefault();
    if (win.isVisible()) {
      win.hide();
      logger.info('[DIAG] close intercepted -> window hidden to tray');
    }
  });

  win.on('closed', () => {
    logger.warn('[DIAG] main window closed');
    mainWindow = null;
  });

  return mainWindow;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function createOAuthWindow(loginUrl: string): BrowserWindow {
  const oauthWindow = new BrowserWindow({
    width: 500,
    height: 700,
    parent: mainWindow || undefined,
    modal: true,
    frame: true,
    resizable: false,
    backgroundColor: '#0a0a0f',
    title: 'Login to Trae',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: 'oauth-session-' + Date.now(), // Isolated session
    },
    show: false,
  });

  oauthWindow.loadURL(loginUrl);
  oauthWindow.once('ready-to-show', () => oauthWindow.show());

  return oauthWindow;
}
