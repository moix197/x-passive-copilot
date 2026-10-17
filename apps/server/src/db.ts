import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

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
  captured_at INTEGER NOT NULL
)`;

export function openDb(home: string): DatabaseSync {
  mkdirSync(home, { recursive: true });
  const db = new DatabaseSync(join(home, 'posts.db'));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(SCHEMA);
  return db;
}
