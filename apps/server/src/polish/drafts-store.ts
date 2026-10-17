import type { DatabaseSync } from 'node:sqlite';

export type DraftKind = 'auto' | 'manual';
export type DraftStatus = 'polishing' | 'ready' | 'needs_edit' | 'error';

export interface DraftSave {
  statusId: string;
  kind: DraftKind;
  status: DraftStatus;
  text: string | null;
  violations: string[];
  error: string | null;
}

const UPSERT = `INSERT OR REPLACE INTO drafts
  (status_id, kind, text, status, violations, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`;

export function saveDraft(db: DatabaseSync, draft: DraftSave, now: number): void {
  db.prepare(UPSERT).run(
    draft.statusId, draft.kind, draft.text, draft.status, JSON.stringify(draft.violations), draft.error, now,
  );
}

export function getDraftStatus(db: DatabaseSync, statusId: string): DraftStatus | null {
  const row = db.prepare('SELECT status FROM drafts WHERE status_id = ?').get(statusId) as
    | { status: DraftStatus }
    | undefined;
  return row?.status ?? null;
}

// A crash mid-job would leave 'polishing' rows that no in-flight job owns.
export function clearStalePolishing(db: DatabaseSync): void {
  db.prepare("DELETE FROM drafts WHERE status = 'polishing'").run();
}

export function parseViolations(raw: string | null): string[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}
