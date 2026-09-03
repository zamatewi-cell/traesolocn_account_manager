import { app } from 'electron';
import path from 'path';
import fs from 'fs';

let storePath: string | null = null;
let storeCache: Record<string, any> | null = null;

function getStorePath(): string {
  if (!storePath) {
    let userDataPath: string;
    try {
      userDataPath = (app && typeof app.getPath === 'function')
        ? app.getPath('userData')
        : (process.env.TEST_USER_DATA_DIR || path.join(require('os').tmpdir(), 'trae-account-manager-test'));
    } catch {
      userDataPath = process.env.TEST_USER_DATA_DIR || path.join(require('os').tmpdir(), 'trae-account-manager-test');
    }
    storePath = path.join(userDataPath, 'config.json');
  }
  return storePath;
}

function loadStore(): Record<string, any> {
  if (storeCache) return storeCache;
  
  try {
    const filePath = getStorePath();
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      storeCache = JSON.parse(content);
    } else {
      storeCache = {};
    }
  } catch {
    storeCache = {};
  }
  
  return storeCache!;
}

function saveStore(): void {
  if (!storeCache) return;
  
  try {
    const filePath = getStorePath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(storeCache, null, 2), 'utf-8');
  } catch (err) {
    // Silently fail for config writes
  }
}

export const store = {
  get<T = any>(key: string, defaultValue?: T): T {
    const data = loadStore();
    return key in data ? data[key] : defaultValue as T;
  },

  set(key: string, value: any): void {
    const data = loadStore();
    data[key] = value;
    saveStore();
  },

  delete(key: string): void {
    const data = loadStore();
    delete data[key];
    saveStore();
  },

  has(key: string): boolean {
    const data = loadStore();
    return key in data;
  },

  clear(): void {
    storeCache = {};
    saveStore();
  },
};
