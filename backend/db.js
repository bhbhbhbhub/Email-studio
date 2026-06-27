const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const databaseDir = path.join(__dirname, '..', 'database');
fs.mkdirSync(databaseDir, { recursive: true });
const db = new Database(path.join(databaseDir, 'email-studio.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
  company_name TEXT DEFAULT '', signature TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS connected_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, provider TEXT NOT NULL,
  email TEXT NOT NULL, access_token TEXT, refresh_token TEXT, expires_at INTEGER,
  status TEXT DEFAULT 'connected', created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, provider), FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS industries (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL,
  color TEXT DEFAULT '#8b5cf6', icon TEXT DEFAULT 'building', created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, name), FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, industry_id INTEGER,
  name TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, is_default INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(industry_id) REFERENCES industries(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, company_name TEXT NOT NULL,
  website TEXT DEFAULT '', email TEXT NOT NULL, industry_id INTEGER, status TEXT DEFAULT 'Pending',
  notes TEXT DEFAULT '', generated_subject TEXT, generated_body TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, sent_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(industry_id) REFERENCES industries(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS activity_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, type TEXT NOT NULL,
  message TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS settings (
  user_id INTEGER PRIMARY KEY, theme TEXT DEFAULT 'dark', notifications INTEGER DEFAULT 1,
  sending_delay INTEGER DEFAULT 3, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
`);

module.exports = db;
