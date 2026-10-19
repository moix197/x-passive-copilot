import type { DatabaseSync } from 'node:sqlite';

/** Integer key/value state in the `meta` table; missing keys read as 0. */
export function getMeta(db: DatabaseSync, key: string): number {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: number } | undefined;
  return row?.value ?? 0;
}

export function setMeta(db: DatabaseSync, key: string, value: number): void {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    value,
  );
}

export function deleteMeta(db: DatabaseSync, key: string): void {
  db.prepare('DELETE FROM meta WHERE key = ?').run(key);
}
