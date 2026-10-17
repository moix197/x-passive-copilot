import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { seedIngestCounters } from './posts';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS posts (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  status_id TEXT NOT NULL UNIQUE,
  author_name TEXT NOT NULL,
  author_handle TEXT NOT NULL,
  text TEXT NOT NULL,
  posted_at TEXT,
  replies INTEGER NOT NULL,
  reposts INTEGER NOT NULL,
  likes INTEGER NOT NULL,
  views INTEGER NOT NULL,
  is_reply INTEGER NOT NULL,
  quoted_status_id TEXT,
  captured_at INTEGER NOT NULL,
  is_own INTEGER NOT NULL DEFAULT 0,
  reply_to TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS triage (
  status_id TEXT PRIMARY KEY,
  score REAL,
  reason TEXT,
  rough_draft TEXT,
  reply_worthy INTEGER NOT NULL DEFAULT 0,
  skip_reason TEXT,
  must_flag TEXT,
  error TEXT,
  triaged_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS drafts (
  status_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  text TEXT,
  status TEXT NOT NULL,
  violations TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS voice (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  profile TEXT,
  sample_count INTEGER NOT NULL,
  failed INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS examples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id TEXT NOT NULL UNIQUE,
  text TEXT NOT NULL,
  polarity TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS digests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bucket INTEGER NOT NULL UNIQUE,
  trends TEXT NOT NULL,
  ideas TEXT NOT NULL,
  created_at INTEGER NOT NULL
)`;

function addMissingColumns(db: DatabaseSync): void {
  const columns = db.prepare('PRAGMA table_info(posts)').all() as unknown as { name: string }[];
  if (!columns.some((c) => c.name === 'is_own')) {
    db.exec('ALTER TABLE posts ADD COLUMN is_own INTEGER NOT NULL DEFAULT 0');
  }
  if (!columns.some((c) => c.name === 'reply_to')) {
    db.exec("ALTER TABLE posts ADD COLUMN reply_to TEXT NOT NULL DEFAULT '[]'");
  }
}

export function openDb(home: string): DatabaseSync {
  mkdirSync(home, { recursive: true });
  const db = new DatabaseSync(join(home, 'posts.db'));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec(SCHEMA);
  addMissingColumns(db);
  seedIngestCounters(db);
  return db;
}
