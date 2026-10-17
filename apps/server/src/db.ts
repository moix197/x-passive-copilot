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
  reply_to TEXT NOT NULL DEFAULT '[]',
  avatar_url TEXT
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
  created_at INTEGER NOT NULL,
  selected_version INTEGER
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
CREATE TABLE IF NOT EXISTS style_notes (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  notes TEXT NOT NULL,
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
);
CREATE TABLE IF NOT EXISTS draft_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_key TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL,
  violations TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS draft_versions_key ON draft_versions (draft_key, id)`;

const ADDED_COLUMNS: { table: string; column: string; definition: string }[] = [
  { table: 'posts', column: 'is_own', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'posts', column: 'reply_to', definition: "TEXT NOT NULL DEFAULT '[]'" },
  { table: 'posts', column: 'avatar_url', definition: 'TEXT' },
  { table: 'drafts', column: 'selected_version', definition: 'INTEGER' },
];

function addMissingColumns(db: DatabaseSync): void {
  for (const { table, column, definition } of ADDED_COLUMNS) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[];
    if (!columns.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// Drafts written before versions existed become their own first version, so regenerating keeps them.
function backfillDraftVersions(db: DatabaseSync): void {
  db.exec(`INSERT INTO draft_versions (draft_key, text, status, violations, created_at)
    SELECT status_id, text, status, violations, created_at FROM drafts
    WHERE text IS NOT NULL AND status IN ('ready', 'needs_edit')
      AND status_id NOT IN (SELECT draft_key FROM draft_versions)`);
}

export function openDb(home: string): DatabaseSync {
  mkdirSync(home, { recursive: true });
  const db = new DatabaseSync(join(home, 'posts.db'));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec(SCHEMA);
  addMissingColumns(db);
  backfillDraftVersions(db);
  seedIngestCounters(db);
  return db;
}
