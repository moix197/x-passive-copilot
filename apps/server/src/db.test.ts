import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from './db';
import { listPosts } from './posts';

// The posts and drafts tables as they were before replies, avatars and draft versions existed.
const PRE_VERSIONING_SCHEMA = `
CREATE TABLE posts (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, status_id TEXT NOT NULL UNIQUE, author_name TEXT NOT NULL,
  author_handle TEXT NOT NULL, text TEXT NOT NULL, posted_at TEXT, replies INTEGER NOT NULL,
  reposts INTEGER NOT NULL, likes INTEGER NOT NULL, views INTEGER NOT NULL, is_reply INTEGER NOT NULL,
  quoted_status_id TEXT, captured_at INTEGER NOT NULL
);
CREATE TABLE drafts (
  status_id TEXT PRIMARY KEY, kind TEXT NOT NULL, text TEXT, status TEXT NOT NULL,
  violations TEXT NOT NULL DEFAULT '[]', error TEXT, created_at INTEGER NOT NULL
);`;

function createOldDb(home: string): void {
  const old = new DatabaseSync(join(home, 'posts.db'));
  old.exec(PRE_VERSIONING_SCHEMA);
  const post = old.prepare(`INSERT INTO posts (status_id, author_name, author_handle, text, posted_at, replies, reposts,
    likes, views, is_reply, quoted_status_id, captured_at) VALUES (?, 'A', 'a', 'old post', NULL, 0, 0, 0, 0, 0, NULL, 1)`);
  post.run('1');
  post.run('2');
  const draft = old.prepare('INSERT INTO drafts (status_id, kind, text, status, violations, error, created_at) VALUES (?, ?, ?, ?, ?, ?, 5)');
  draft.run('1', 'manual', 'old reply', 'needs_edit', '["hashtags"]', null);
  draft.run('2', 'manual', null, 'error', '[]', 'timeout');
  old.close();
}

// Each openDb on a fresh file creates a WAL database; on Windows that is disk-bound (100ms-1s idle, seconds
// under load), and these tests open 2-3 per case, so the 5s default is too tight. Migration needs a real file.
const FILE_DB_TIMEOUT_MS = 30_000;
const homes: string[] = [];

function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'xc-db-'));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true, maxRetries: 3 });
});

describe('openDb migration', () => {
  it('turns a pre-versioning draft into version 1, selected, and leaves failed drafts without versions', () => {
    const home = makeHome();
    createOldDb(home);
    openDb(home).close();
    const db = openDb(home);

    const polish = new Map(listPosts(db, 10, null).posts.map((p) => [p.statusId, p.polish]));
    const migrated = polish.get('1');
    expect(migrated?.versions).toEqual([{ id: expect.any(Number), text: 'old reply', status: 'needs_edit', violations: ['hashtags'] }]);
    expect(migrated?.selectedVersion).toBe(migrated?.versions[0]?.id);
    expect(migrated?.text).toBe('old reply');
    expect(polish.get('2')?.versions).toEqual([]);
    db.close();
  }, FILE_DB_TIMEOUT_MS);
});

describe('openDb idea kinds migration', () => {
  it('labels ideas saved before kinds existed as spacehub, keeping their order', () => {
    const home = makeHome();
    const first = openDb(home);
    const insert = first.prepare("INSERT INTO digests (bucket, trends, ideas, created_at) VALUES (?, '[]', ?, 1)");
    insert.run(1, JSON.stringify([{ text: 'a', feature: 'f' }, { text: 'b', feature: 'g' }]));
    insert.run(2, JSON.stringify([{ text: 'c', feature: 'f', kind: 'eco' }]));
    first.close();
    const db = openDb(home);
    const ideas = (db.prepare('SELECT ideas FROM digests ORDER BY id').all() as { ideas: string }[]).map((r) => JSON.parse(r.ideas));
    expect(ideas).toEqual([
      [{ kind: 'spacehub', text: 'a', feature: 'f' }, { kind: 'spacehub', text: 'b', feature: 'g' }],
      [{ text: 'c', feature: 'f', kind: 'eco' }],
    ]);
    db.close();
  }, FILE_DB_TIMEOUT_MS);
});
