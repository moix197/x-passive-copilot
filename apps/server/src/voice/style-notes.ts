import type { DatabaseSync } from 'node:sqlite';

export function readStyleNotes(db: DatabaseSync): string {
  const row = db.prepare('SELECT notes FROM style_notes WHERE id = 1').get() as { notes: string } | undefined;
  return row?.notes ?? '';
}

export function saveStyleNotes(db: DatabaseSync, notes: string, now: number): void {
  db.prepare(
    `INSERT INTO style_notes (id, notes, updated_at) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET notes = excluded.notes, updated_at = excluded.updated_at`,
  ).run(notes.trim(), now);
}
