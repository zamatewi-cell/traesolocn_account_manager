import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { PATHS } from '../utils/paths';
import { logger } from '../utils/logger';

let dbInstance: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return dbInstance;
}

export function initDatabase(): Database.Database {
  if (dbInstance) {
    return dbInstance;
  }

  // Ensure the directory exists
  const dbDir = path.dirname(PATHS.DB_PATH);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  logger.info('Initializing database at:', PATHS.DB_PATH);

  dbInstance = new Database(PATHS.DB_PATH);

  // Enable WAL mode for better performance
  dbInstance.pragma('journal_mode = WAL');
  dbInstance.pragma('foreign_keys = ON');

  // Create schema
  createSchema(dbInstance);

  // Run migrations
  runMigrations(dbInstance);

  logger.info('Database initialized successfully');
  return dbInstance;
}

function createSchema(db: Database.Database): void {
  // Create accounts table with all current columns
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      nickname TEXT NOT NULL,
      email TEXT,
      avatar_url TEXT,
      phone TEXT,
      token_encrypted TEXT NOT NULL,
      refresh_token TEXT,
      host TEXT NOT NULL DEFAULT 'https://api.trae.cn',
      source TEXT NOT NULL DEFAULT 'oauth',
      install_name TEXT,
      is_active INTEGER NOT NULL DEFAULT 0,
      is_checked_in INTEGER NOT NULL DEFAULT 0,
      checkin_credits INTEGER NOT NULL DEFAULT 0,
      last_checkin_at TEXT,
      credits_balance REAL NOT NULL DEFAULT 0,
      pay_status TEXT,
      pay_identity_str TEXT,
      pay_expire_at TEXT,
      entitlement_packs TEXT,
      token_expired_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_refreshed_at TEXT,
      deleted_at TEXT
    )
  `);

  // Create indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_accounts_active ON accounts(is_active);
    CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id);
    CREATE INDEX IF NOT EXISTS idx_accounts_deleted ON accounts(deleted_at);
  `);

  // Auto check-in execution history (30-day rolling retention)
  db.exec(`
    CREATE TABLE IF NOT EXISTS auto_checkin_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trigger_type TEXT NOT NULL DEFAULT 'auto',
      run_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      success_count INTEGER NOT NULL DEFAULT 0,
      already_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      results_json TEXT
    )
  `);

  // Purge records older than 30 days
  db.prepare(
    "DELETE FROM auto_checkin_records WHERE run_at < datetime('now', 'localtime', '-30 days')"
  ).run();

  logger.info('Database schema ready');
}

function runMigrations(db: Database.Database): void {
  // Check existing columns and add missing ones (for upgrading from older versions)
  const columns = db.prepare("PRAGMA table_info(accounts)").all() as Array<{ name: string }>;
  const existingColumns = new Set(columns.map(c => c.name));

  const migrations: Array<{ col: string; def: string }> = [
    { col: 'phone', def: 'TEXT' },
    { col: 'refresh_token', def: 'TEXT' },
    { col: 'host', def: "TEXT NOT NULL DEFAULT 'https://api.trae.cn'" },
    { col: 'install_name', def: 'TEXT' },
    { col: 'checkin_credits', def: 'INTEGER NOT NULL DEFAULT 0' },
    { col: 'pay_identity_str', def: 'TEXT' },
    { col: 'entitlement_packs', def: 'TEXT' },
    { col: 'token_expired_at', def: 'TEXT' },
    { col: 'today_usage', def: 'REAL NOT NULL DEFAULT 0' },
    { col: 'total_usage', def: 'REAL NOT NULL DEFAULT 0' },
    // Full decrypted auth blob (encrypted with DPAPI) captured at import time.
    // Required for account switching: Trae validates userRegion/scope/loginScope
    // fields and falls back to logged-out state when they are missing.
    { col: 'auth_blob_encrypted', def: 'BLOB' },
  ];

  for (const { col, def } of migrations) {
    if (!existingColumns.has(col)) {
      logger.info(`Adding column: ${col}`);
      db.exec(`ALTER TABLE accounts ADD COLUMN ${col} ${def}`);
    }
  }
}

export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    logger.info('Database closed');
  }
}
