-- Initial schema for Trae Account Manager

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname TEXT NOT NULL DEFAULT 'Unknown',
  email TEXT,
  user_id TEXT,
  avatar_url TEXT,
  token_encrypted BLOB NOT NULL,
  is_active INTEGER DEFAULT 0,
  is_checked_in INTEGER DEFAULT 0,
  last_checkin_at TEXT,
  credits_balance INTEGER DEFAULT 0,
  pay_status TEXT,
  pay_expire_at TEXT,
  source TEXT DEFAULT 'token_import',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_refreshed_at TEXT,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_accounts_active ON accounts(is_active);
CREATE INDEX IF NOT EXISTS idx_accounts_deleted ON accounts(deleted_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS checkin_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  checkin_date TEXT NOT NULL,
  credits_earned INTEGER DEFAULT 0,
  status TEXT NOT NULL,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_checkin_account_date 
  ON checkin_history(account_id, checkin_date);
