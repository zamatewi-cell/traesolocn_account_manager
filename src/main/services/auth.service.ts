import { BrowserWindow } from 'electron';
import { createOAuthWindow } from '../window';
import { logger } from '../utils/logger';
import { getTraeStoragePaths } from '../utils/paths';
import { getCryptoService } from './crypto.service';
import crypto from 'crypto';
import http from 'http';
import fs from 'fs';

// Trae CN login guidance endpoints (from cockpit-tools)
const TRAE_CN_LOGIN_GUIDANCE_URLS = [
  'https://api.trae.cn/cloudide/api/v3/trae/GetLoginGuidance',
  'https://api.trae.com.cn/cloudide/api/v3/trae/GetLoginGuidance',
  'https://www.trae.cn/cloudide/api/v3/trae/GetLoginGuidance',
];

const TRAE_AUTH_CODE_EXCHANGE_PATH = '/trae/api/v3/oauth/ExchangeToken';
const TRAE_GET_USER_INFO_PATH = '/cloudide/api/v3/trae/GetUserInfo';
const TRAE_AUTH_CLIENT_ID = 'ono9krqynydwx5';
const TRAE_SOLO_AUTH_CLIENT_ID = 'en1oxy7wnw8j9n';
const CALLBACK_PATH = '/authorize';
const TRAE_AUTHORIZATION_PATH = '/authorization';
const TRAE_DEFAULT_APP_VERSION = '3.5.54';
const TRAE_DEFAULT_APP_TYPE = 'stable';

const TRAE_CN_ACCOUNT_API_ORIGIN = 'https://api.trae.cn';

interface OAuthResult {
  token: string;
  refreshToken?: string;
  host?: string;
  expiredAt?: string;
}

interface CallbackPayload {
  authCode?: string;
  refreshToken?: string;
  cloudideToken?: string;
}

interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
}

interface DeviceKeyPair {
  privateKeyPem: string;
  publicKeyPem: string;
}

// ============ Helpers ============

function pickString(root: any, ...paths: string[][]): string | undefined {
  for (const path of paths) {
    let cur = root;
    let found = true;
    for (const key of path) {
      if (cur == null || typeof cur !== 'object') {
        found = false;
        break;
      }
      cur = cur[key];
    }
    if (found && cur != null && typeof cur === 'string' && cur.length > 0) {
      return cur;
    }
  }
  return undefined;
}

function generatePkcePair(): PkcePair {
  const random = crypto.randomBytes(48);
  const codeVerifier = random.toString('base64url');
  const digest = crypto.createHash('sha256').update(codeVerifier).digest();
  const codeChallenge = digest.toString('base64url');
  return { codeVerifier, codeChallenge };
}

function pemWrap(label: string, der: Buffer): string {
  const encoded = der.toString('base64');
  let pem = `-----BEGIN ${label}-----\n`;
  for (let i = 0; i < encoded.length; i += 64) {
    pem += encoded.slice(i, i + 64) + '\n';
  }
  pem += `-----END ${label}-----\n`;
  return pem;
}

function generateDeviceKeyPair(): DeviceKeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const publicKeyDer = publicKey.export({ type: 'spki', format: 'der' });
  const privateKeyDer = privateKey.export({ type: 'pkcs8', format: 'der' });
  return {
    publicKeyPem: pemWrap('PUBLIC KEY', publicKeyDer),
    privateKeyPem: pemWrap('PRIVATE KEY', privateKeyDer),
  };
}

function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

/**
 * A valid Trae access token is a JWT: header.payload.signature (3 parts, starts with "eyJ").
 */
function isValidToken(token: string): boolean {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  return token.startsWith('eyJ') && parts.length === 3 && token.length > 100;
}

/**
 * Decode the expiry timestamp from a JWT access token (ISO string or null).
 */
function decodeJwtExpiry(token: string): string | undefined {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return undefined;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
    const exp = payload?.exp;
    if (typeof exp === 'number' && exp > 0) {
      return new Date(exp * 1000).toISOString();
    }
  } catch {
    // ignore
  }
  return undefined;
}

function buildVerificationUri(
  loginHost: string,
  loginTraceId: string,
  callbackUrl: string,
  codeChallenge: string,
  clientId: string,
  machineId: string,
  deviceId: string,
): string {
  const params: Record<string, string> = {
    login_version: '1',
    auth_from: 'trae',
    login_channel: 'native_ide',
    plugin_version: 'local',
    auth_type: 'local',
    client_id: clientId,
    redirect: '0',
    login_trace_id: loginTraceId,
    auth_callback_url: callbackUrl,
    machine_id: machineId,
    device_id: deviceId,
    x_device_id: deviceId,
    x_machine_id: machineId,
    x_device_brand: 'Microsoft',
    x_device_type: 'windows',
    x_os_version: 'Windows 11',
    x_env: '',
    x_app_version: TRAE_DEFAULT_APP_VERSION,
    x_app_type: TRAE_DEFAULT_APP_TYPE,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  };
  const query = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  const base = loginHost.replace(/\/+$/, '');
  return `${base}${TRAE_AUTHORIZATION_PATH}?${query}`;
}

function buildDeviceInfo(publicKeyPem: string, machineId: string, deviceId: string): Record<string, string> {
  return {
    DeviceID: deviceId,
    MachineID: machineId,
    PlatformCode: 'IDE_PC',
    DeviceType: 'PC',
    DeviceName: 'PC',
    DeviceModel: 'Microsoft',
    ClientVersion: TRAE_DEFAULT_APP_VERSION,
    DevicePublicKey: publicKeyPem,
    DeviceBrand: 'Microsoft',
    DeviceCPU: '',
    OSInfo: 'windows',
    OSVersion: 'Windows 11',
  };
}

function startCallbackServer(port: number): Promise<CallbackPayload> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
        if (url.pathname !== CALLBACK_PATH) {
          res.writeHead(404, { 'Content-Type': 'text/html' });
          res.end('<html><body>Not Found</body></html>');
          return;
        }
        const params = url.searchParams;
        const authCode =
          params.get('authCode') ||
          params.get('auth_code') ||
          params.get('AuthCode') ||
          params.get('code') ||
          undefined;
        const refreshToken =
          params.get('refreshToken') || params.get('refresh_token') || undefined;
        const cloudideToken =
          params.get('x-cloudide-token') ||
          params.get('accessToken') ||
          params.get('access_token') ||
          params.get('token') ||
          undefined;

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(
          '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>登录成功</title></head>' +
            '<body style="background:#0f172a;color:#e2e8f0;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">' +
            '<div style="text-align:center"><h2>✅ 登录成功</h2><p>现在可以关闭此窗口并返回应用。</p></div></body></html>'
        );
        server.close();
        resolve({ authCode, refreshToken, cloudideToken });
      } catch (err) {
        res.writeHead(500);
        res.end('Error');
        server.close();
        reject(err);
      }
    });
    server.on('error', reject);
    server.listen(port, '127.0.0.1');
  });
}

// ============ AuthService ============

export class AuthService {
  /**
   * Start OAuth login flow.
   *
   * Strategy (mirrors cockpit-tools and is proven to work on this machine):
   * 1. Snapshot the tokens currently present in the installed Trae storage.json files.
   * 2. Open the Trae login page in a browser window.
   * 3. Monitor storage.json for a NEW valid token (one that differs from the snapshot),
   *    which Trae writes after a successful login.
   * 4. Validate the captured token via GetUserInfo before returning.
   */
  async startOAuth(): Promise<OAuthResult> {
    const snapshot = this.snapshotStorageTokens();
    logger.info(`[OAuth] Pre-login storage snapshot: ${snapshot.size} token(s)`);

    return new Promise<OAuthResult>((resolve, reject) => {
      let oauthWindow: BrowserWindow | null = null;
      let resolved = false;
      let pollTimer: NodeJS.Timeout | null = null;
      let webPollTimer: NodeJS.Timeout | null = null;
      let watchers: fs.FSWatcher[] = [];
      const startedAt = Date.now();

      const finish = (token: string, source: string, extra?: { refreshToken?: string; host?: string; expiredAt?: string }) => {
        if (resolved) return;
        resolved = true;
        cleanup();
        logger.info(`[OAuth] Captured token via ${source}`);
        resolve({
          token,
          refreshToken: extra?.refreshToken,
          host: extra?.host || 'https://api.trae.cn',
          expiredAt: extra?.expiredAt || decodeJwtExpiry(token),
        });
      };

      const cleanup = () => {
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        if (webPollTimer) { clearInterval(webPollTimer); webPollTimer = null; }
        for (const w of watchers) { try { w.close(); } catch { /* ignore */ } }
        watchers = [];
        if (oauthWindow && !oauthWindow.isDestroyed()) { oauthWindow.close(); }
        oauthWindow = null;
      };

      // Capture a NEW token from local Trae storage (desktop-app login)
      const tryCaptureFromStorage = (): boolean => {
        if (resolved) return true;
        for (const p of getTraeStoragePaths()) {
          try {
            if (!fs.existsSync(p.storagePath)) continue;
            const storage = JSON.parse(fs.readFileSync(p.storagePath, 'utf-8'));
            const encrypted = storage['iCubeAuthInfo://icube.cloudide'];
            if (!encrypted || typeof encrypted !== 'string') continue;
            const decrypted = getCryptoService().decryptTraeBlob(encrypted);
            if (!decrypted || typeof decrypted !== 'object') continue;
            const token = (decrypted as any).token;
            if (!token || !isValidToken(token)) continue;
            if (snapshot.has(token)) continue; // only a NEW login
            finish(token, 'storage.json', {
              refreshToken: (decrypted as any).refreshToken,
              host: (decrypted as any).host || 'https://api.trae.cn',
              expiredAt: (decrypted as any).expiredAt || decodeJwtExpiry(token),
            });
            return true;
          } catch {
            // ignore
          }
        }
        return false;
      };

      // Capture a valid JWT from the web page (web login) via localStorage / network
      const tryCaptureFromWeb = async (): Promise<boolean> => {
        if (resolved || !oauthWindow || oauthWindow.isDestroyed()) return true;
        try {
          const script = `
            (() => {
              const out = [];
              try {
                for (let i = 0; i < localStorage.length; i++) {
                  const k = localStorage.key(i);
                  if (!k) continue;
                  const v = localStorage.getItem(k);
                  if (v && v.length > 50 && (k.toLowerCase().includes('token') || k.toLowerCase().includes('auth') || v.startsWith('eyJ'))) {
                    out.push(v);
                  }
                }
              } catch (e) {}
              return JSON.stringify(out);
            })()
          `;
          const raw = await oauthWindow.webContents.executeJavaScript(script);
          const values: string[] = JSON.parse(raw || '[]');
          for (const v of values) {
            if (isValidToken(v)) { finish(v, 'web-localStorage'); return true; }
            const m = v.match(/eyJ[a-zA-Z0-9_\-]{20,}\.[a-zA-Z0-9_\-]{20,}\.[a-zA-Z0-9_\-]{20,}/);
            if (m && isValidToken(m[0])) { finish(m[0], 'web-localStorage'); return true; }
          }
        } catch {
          // ignore
        }
        return false;
      };

      try {
        oauthWindow = createOAuthWindow('https://www.trae.cn/login');
        oauthWindow.on('closed', () => {
          if (!resolved) {
            cleanup();
            reject(new Error('登录窗口已关闭，请重试。'));
          }
        });

        // Capture token from request headers (x-cloudide-token / x-ide-token)
        const ses = oauthWindow.webContents.session;
        ses.webRequest.onBeforeSendHeaders((details, callback) => {
          if (!resolved) {
            const headers = details.requestHeaders || {};
            for (const [key, value] of Object.entries(headers)) {
              const lowerKey = key.toLowerCase();
              if ((lowerKey === 'x-cloudide-token' || lowerKey === 'x-ide-token') && value && value.length > 20 && isValidToken(value)) {
                finish(value, 'web-request-header');
                break;
              }
            }
          }
          callback({ cancel: false, requestHeaders: details.requestHeaders });
        });

        // Poll storage.json for the new token (desktop login)
        pollTimer = setInterval(() => {
          if (tryCaptureFromStorage()) return;
          if (Date.now() - startedAt > 5 * 60 * 1000) {
            cleanup();
            reject(new Error('登录超时，请重试。'));
          }
        }, 1500);

        // Poll the web page for a token (web login)
        webPollTimer = setInterval(() => {
          tryCaptureFromWeb();
        }, 2000);

        // Also watch storage.json for immediate detection
        for (const p of getTraeStoragePaths()) {
          try {
            if (!fs.existsSync(p.storagePath)) continue;
            const watcher = fs.watch(p.storagePath, () => setTimeout(tryCaptureFromStorage, 300));
            watchers.push(watcher);
          } catch {
            // ignore
          }
        }
      } catch (err) {
        cleanup();
        reject(err);
      }
    });
  }

  /**
   * Snapshot the tokens currently present in all Trae storage.json files.
   * Used to detect a NEW login during the OAuth flow.
   */
  private snapshotStorageTokens(): Set<string> {
    const tokens = new Set<string>();
    for (const p of getTraeStoragePaths()) {
      try {
        if (!fs.existsSync(p.storagePath)) continue;
        const storage = JSON.parse(fs.readFileSync(p.storagePath, 'utf-8'));
        const encrypted = storage['iCubeAuthInfo://icube.cloudide'];
        if (!encrypted || typeof encrypted !== 'string') continue;
        const decrypted = getCryptoService().decryptTraeBlob(encrypted);
        if (decrypted && typeof decrypted === 'object' && (decrypted as any).token) {
          tokens.add((decrypted as any).token);
        }
      } catch {
        // ignore
      }
    }
    return tokens;
  }

  /**
   * Get the login host from the Trae login guidance API.
   */
  private async requestLoginGuidance(loginTraceId: string): Promise<string> {
    for (const url of TRAE_CN_LOGIN_GUIDANCE_URLS) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'Trae/1.0.0 antigravity-cockpit-tools',
          },
          body: JSON.stringify({ loginTraceID: loginTraceId, login_trace_id: loginTraceId }),
        });
        if (!res.ok) continue;
        const data = await res.json();
        const host = pickString(
          data,
          ['Result', 'LoginHost'],
          ['Result', 'loginHost'],
          ['result', 'loginHost'],
          ['data', 'loginHost'],
          ['LoginHost'],
          ['loginHost']
        );
        if (host) return host;
      } catch {
        // try next endpoint
      }
    }
    return 'https://www.trae.cn';
  }

  /**
   * Exchange the auth code for an access token using the Trae ExchangeToken API.
   */
  private async exchangeAuthCode(
    authCode: string,
    codeVerifier: string,
    machineId: string,
    deviceId: string
  ): Promise<{ token?: string; refreshToken?: string }> {
    const keyPair = generateDeviceKeyPair();
    const deviceInfo = buildDeviceInfo(keyPair.publicKeyPem, machineId, deviceId);
    const body = {
      ClientID: TRAE_AUTH_CLIENT_ID,
      AuthCode: authCode,
      CodeVerifier: codeVerifier,
      DeviceInfo: deviceInfo,
      IDEVersion: TRAE_DEFAULT_APP_VERSION,
    };

    const urls = [
      `${TRAE_CN_ACCOUNT_API_ORIGIN}${TRAE_AUTH_CODE_EXCHANGE_PATH}`,
      `https://api.trae.com.cn${TRAE_AUTH_CODE_EXCHANGE_PATH}`,
      `https://www.trae.cn${TRAE_AUTH_CODE_EXCHANGE_PATH}`,
    ];

    for (const url of urls) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'x-cloudide-token': '',
          },
          body: JSON.stringify(body),
        });
        const text = await res.text();
        let data: any;
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
        const token = pickString(
          data,
          ['Result', 'Token'],
          ['Result', 'token'],
          ['Result', 'AccessToken'],
          ['result', 'token'],
          ['data', 'token'],
          ['Token'],
          ['token']
        );
        if (token) {
          const refreshToken = pickString(
            data,
            ['Result', 'RefreshToken'],
            ['Result', 'refreshToken'],
            ['result', 'refreshToken'],
            ['data', 'refreshToken'],
            ['refreshToken']
          );
          return { token, refreshToken };
        }
      } catch {
        // try next origin
      }
    }
    return {};
  }

  /**
   * Monitor Trae storage.json files for a valid auth token (fallback strategy).
   */
  private monitorStorageForToken(): Promise<OAuthResult> {
    return new Promise((resolve) => {
      const paths = getTraeStoragePaths();
      let resolved = false;
      let attempts = 0;
      const timer = setInterval(() => {
        attempts++;
        if (resolved || attempts > 200) {
          clearInterval(timer);
          if (!resolved) resolve({ token: '' });
          return;
        }
        for (const p of paths) {
          try {
            if (!fs.existsSync(p.storagePath)) continue;
            const content = fs.readFileSync(p.storagePath, 'utf-8');
            const storage = JSON.parse(content);
            const encrypted = storage['iCubeAuthInfo://icube.cloudide'];
            if (!encrypted || typeof encrypted !== 'string') continue;
            const cryptoService = getCryptoService();
            const decrypted = cryptoService.decryptTraeBlob(encrypted);
            if (decrypted && typeof decrypted === 'object' && (decrypted as any).token) {
              const token = (decrypted as any).token;
              if (!isValidToken(token)) continue;
              resolved = true;
              clearInterval(timer);
              resolve({
                token,
                refreshToken: (decrypted as any).refreshToken,
                host: 'https://api.trae.cn',
                expiredAt: (decrypted as any).expiredAt || decodeJwtExpiry(token),
              });
              return;
            }
          } catch {
            // ignore
          }
        }
      }, 1500);
    });
  }

  /**
   * Legacy fallback: open the web login page and scrape tokens from the browser.
   */
  private async startOAuthLegacy(): Promise<OAuthResult> {
    const TRAE_LOGIN_URL = 'https://www.trae.cn/login';
    return new Promise((resolve, reject) => {
      let oauthWindow: BrowserWindow | null = null;
      let resolved = false;
      let tokenCheckInterval: NodeJS.Timeout | null = null;
      let storageWatchers: fs.FSWatcher[] = [];
      let storagePollTimer: NodeJS.Timeout | null = null;

      const cleanup = () => {
        if (tokenCheckInterval) {
          clearInterval(tokenCheckInterval);
          tokenCheckInterval = null;
        }
        if (storagePollTimer) {
          clearInterval(storagePollTimer);
          storagePollTimer = null;
        }
        for (const watcher of storageWatchers) {
          try { watcher.close(); } catch { /* ignore */ }
        }
        storageWatchers = [];
        if (oauthWindow && !oauthWindow.isDestroyed()) {
          oauthWindow.close();
        }
        oauthWindow = null;
      };

      const handleTokenFound = (token: string, source: string, host?: string) => {
        if (resolved) return;
        resolved = true;
        logger.info(`[OAuthLegacy] Token captured via ${source}`);
        setTimeout(() => {
          cleanup();
          resolve({ token, host });
        }, 300);
      };

      const tryExtractTokenFromText = (text: string): string | null => {
        if (!text) return null;
        const jwtMatch = text.match(/eyJ[a-zA-Z0-9_\-]{20,}\.[a-zA-Z0-9_\-]{20,}\.[a-zA-Z0-9_\-]{20,}/);
        if (jwtMatch) return jwtMatch[0];
        const patterns = [
          /x-cloudide-token["':\s]+([a-zA-Z0-9_\-\.]{20,})/i,
          /x-ide-token["':\s]+([a-zA-Z0-9_\-\.]{20,})/i,
          /access_token["':\s]+([a-zA-Z0-9_\-\.]{20,})/i,
          /"token"\s*:\s*"([a-zA-Z0-9_\-\.]{20,})"/,
          /token["':\s]+([a-zA-Z0-9_\-\.]{30,})/i,
        ];
        for (const pattern of patterns) {
          const match = text.match(pattern);
          if (match && match[1] && match[1].length >= 20) return match[1];
        }
        return null;
      };

      const tryDecryptAndExtractToken = (encryptedValue: string): string | null => {
        try {
          const cryptoService = getCryptoService();
          const decrypted = cryptoService.decryptTraeBlob(encryptedValue);
          if (decrypted && typeof decrypted === 'object' && (decrypted as any).token) {
            return (decrypted as any).token;
          }
        } catch {
          // ignore
        }
        return null;
      };

      const setupStorageMonitoring = () => {
        const paths = getTraeStoragePaths();
        const readStorageForToken = () => {
          if (resolved) return;
          for (const p of paths) {
            try {
              if (!fs.existsSync(p.storagePath)) continue;
              const content = fs.readFileSync(p.storagePath, 'utf-8');
              const storage = JSON.parse(content);
              const encrypted = storage['iCubeAuthInfo://icube.cloudide'];
              if (!encrypted || typeof encrypted !== 'string') continue;
              const decrypted = tryDecryptAndExtractToken(encrypted);
              if (decrypted) {
                handleTokenFound(decrypted, 'storage.json', 'https://api.trae.cn');
                return;
              }
            } catch {
              // ignore
            }
          }
        };
        storagePollTimer = setInterval(readStorageForToken, 1500);
        for (const p of paths) {
          try {
            if (!fs.existsSync(p.storagePath)) continue;
            const watcher = fs.watch(p.storagePath, () => {
              setTimeout(readStorageForToken, 300);
            });
            storageWatchers.push(watcher);
          } catch {
            // ignore
          }
        }
      };

      try {
        oauthWindow = createOAuthWindow(TRAE_LOGIN_URL);

        oauthWindow.webContents.on('did-navigate', (_event, url) => {
          const token = tryExtractTokenFromText(url);
          if (token) handleTokenFound(token, 'url');
        });

        const checkForTokens = async () => {
          if (!oauthWindow || resolved || oauthWindow.isDestroyed()) return;
          try {
            const extractionScript = `
              (() => {
                const results = [];
                const knownKeys = ['iCubeAuthInfo://icube.cloudide','trae_token','trae-auth-token','cloudide_token','icube_token'];
                for (const key of knownKeys) {
                  try { const v = localStorage.getItem(key); if (v) results.push({ source:'localStorage:'+key, value:v }); } catch(e){}
                }
                for (let i = 0; i < localStorage.length; i++) {
                  const key = localStorage.key(i); if (!key) continue;
                  try { const v = localStorage.getItem(key); if (v && v.length > 50 && (key.toLowerCase().includes('token')||key.toLowerCase().includes('auth'))) results.push({ source:'localStorage-scan:'+key, value:v }); } catch(e){}
                }
                return JSON.stringify(results);
              })()
            `;
            const result = await oauthWindow.webContents.executeJavaScript(extractionScript);
            const found = JSON.parse(result) as Array<{ source: string; value: string }>;
            for (const item of found) {
              const decryptedToken = tryDecryptAndExtractToken(item.value);
              if (decryptedToken) {
                handleTokenFound(decryptedToken, 'decrypted:' + item.source, 'https://api.trae.cn');
                return;
              }
              const token = tryExtractTokenFromText(item.value);
              if (token) {
                handleTokenFound(token, item.source);
                return;
              }
              if (item.value.startsWith('eyJ') && item.value.length > 50) {
                handleTokenFound(item.value, item.source + ':jwt');
                return;
              }
            }
          } catch {
            // ignore
          }
        };

        oauthWindow.webContents.on('did-finish-load', () => {
          if (!tokenCheckInterval) {
            checkForTokens();
            tokenCheckInterval = setInterval(checkForTokens, 2000);
          }
        });

        const ses = oauthWindow.webContents.session;
        ses.webRequest.onBeforeSendHeaders((details, callback) => {
          if (resolved) {
            callback({ cancel: false, requestHeaders: details.requestHeaders });
            return;
          }
          const headers = details.requestHeaders || {};
          for (const [key, value] of Object.entries(headers)) {
            const lowerKey = key.toLowerCase();
            if ((lowerKey === 'x-cloudide-token' || lowerKey === 'x-ide-token') && value && value.length > 20) {
              handleTokenFound(value, 'request-header:' + key);
              break;
            }
          }
          callback({ cancel: false, requestHeaders: details.requestHeaders });
        });

        setupStorageMonitoring();

        oauthWindow.on('closed', () => {
          if (tokenCheckInterval) clearInterval(tokenCheckInterval);
          if (storagePollTimer) clearInterval(storagePollTimer);
          if (!resolved) reject(new Error('登录窗口已关闭，请重试。'));
        });

        setTimeout(() => {
          if (!resolved) {
            cleanup();
            reject(new Error('登录超时，请重试。'));
          }
        }, 5 * 60 * 1000);
      } catch (err) {
        cleanup();
        reject(err);
      }
    });
  }
}

// Singleton
let authServiceInstance: AuthService | null = null;

export function getAuthService(): AuthService {
  if (!authServiceInstance) {
    authServiceInstance = new AuthService();
  }
  return authServiceInstance;
}
