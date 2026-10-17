import type { DatabaseSync } from 'node:sqlite';
import type { MustFlag, TriageItem } from '@xc/shared';

const UPSERT = `INSERT OR REPLACE INTO triage
  (status_id, score, reason, rough_draft, reply_worthy, skip_reason, must_flag, error, triaged_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

export function saveSkipped(db: DatabaseSync, statusId: string, reason: string, now: number): void {
  db.prepare(UPSERT).run(statusId, null, null, null, 0, reason, null, null, now);
}

export function saveError(
  db: DatabaseSync,
  statusId: string,
  error: string,
  mustFlag: MustFlag | null,
  now: number,
): void {
  db.prepare(UPSERT).run(statusId, null, null, null, 0, null, mustFlag, error, now);
}

export function saveEditedRoughDraft(db: DatabaseSync, statusId: string, text: string): void {
  db.prepare('UPDATE triage SET rough_draft = ? WHERE status_id = ?').run(text, statusId);
}

export function saveResult(db: DatabaseSync, item: TriageItem, mustFlag: MustFlag | null, now: number): void {
  const worthy = item.relevant && item.replyWorthy ? 1 : 0;
  db.prepare(UPSERT).run(item.statusId, item.score, item.reason, item.roughDraft, worthy, null, mustFlag, null, now);
}
