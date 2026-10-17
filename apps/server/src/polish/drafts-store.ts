import type { DatabaseSync } from 'node:sqlite';
import { DraftVersionSchema, type DraftVersion } from '@xc/shared';
import { z } from 'zod';

export type DraftKind = 'auto' | 'manual';
export type DraftStatus = 'polishing' | 'ready' | 'needs_edit' | 'error';
type VersionStatus = DraftVersion['status'];

export interface DraftSave {
  statusId: string;
  kind: DraftKind;
  status: DraftStatus;
  text: string | null;
  violations: string[];
  error: string | null;
  selectedVersion?: number | null;
}

export interface VersionSave {
  text: string;
  status: VersionStatus;
  violations: string[];
}

export type SelectOutcome = 'ok' | 'not_found' | 'busy';

const UPSERT = `INSERT OR REPLACE INTO drafts
  (status_id, kind, text, status, violations, error, created_at, selected_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

// A draft that has text is back to ready / needs_edit once nothing is polishing it.
const SETTLED_STATUS = "CASE WHEN violations = '[]' THEN 'ready' ELSE 'needs_edit' END";

export function saveDraft(db: DatabaseSync, draft: DraftSave, now: number): void {
  db.prepare(UPSERT).run(
    draft.statusId, draft.kind, draft.text, draft.status, JSON.stringify(draft.violations), draft.error, now,
    draft.selectedVersion ?? null,
  );
}

export function getDraft(db: DatabaseSync, key: string): { status: DraftStatus; kind: DraftKind } | null {
  const row = db.prepare('SELECT status, kind FROM drafts WHERE status_id = ?').get(key) as
    | { status: DraftStatus; kind: DraftKind }
    | undefined;
  return row ?? null;
}

export function addVersion(db: DatabaseSync, key: string, version: VersionSave, now: number): number {
  const result = db
    .prepare('INSERT INTO draft_versions (draft_key, text, status, violations, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(key, version.text, version.status, JSON.stringify(version.violations), now);
  return Number(result.lastInsertRowid);
}

export function listVersionTexts(db: DatabaseSync, key: string): string[] {
  const rows = db.prepare('SELECT text FROM draft_versions WHERE draft_key = ? ORDER BY id').all(key) as unknown as {
    text: string;
  }[];
  return rows.map((r) => r.text);
}

/** Regenerating keeps the selected text visible; only the status flips. */
export function markRegenerating(db: DatabaseSync, key: string): void {
  db.prepare("UPDATE drafts SET status = 'polishing', error = NULL WHERE status_id = ?").run(key);
}

export function settleFailedRegenerate(db: DatabaseSync, key: string, error: string): void {
  db.prepare(`UPDATE drafts SET status = ${SETTLED_STATUS}, error = ? WHERE status_id = ?`).run(error, key);
}

export function selectVersion(db: DatabaseSync, key: string, versionId: number): SelectOutcome {
  const draft = getDraft(db, key);
  const version = db
    .prepare('SELECT text, status, violations FROM draft_versions WHERE draft_key = ? AND id = ?')
    .get(key, versionId) as { text: string; status: VersionStatus; violations: string } | undefined;
  if (!draft || !version) return 'not_found';
  if (draft.status === 'polishing') return 'busy';
  db.prepare(
    'UPDATE drafts SET text = ?, status = ?, violations = ?, error = NULL, selected_version = ? WHERE status_id = ?',
  ).run(version.text, version.status, version.violations, versionId, key);
  return 'ok';
}

/** An accepted edit replaces the selected version's text, so it is what the panel shows and copies. */
export function saveEditedText(db: DatabaseSync, key: string, text: string): void {
  db.prepare(
    `UPDATE draft_versions SET text = ?, status = 'ready', violations = '[]' WHERE draft_key = ? AND id =
       (SELECT COALESCE(selected_version, (SELECT MAX(id) FROM draft_versions WHERE draft_key = ?)) FROM drafts WHERE status_id = ?)`,
  ).run(text, key, key, key);
  db.prepare(
    `UPDATE drafts SET text = ?, violations = '[]', status = CASE WHEN status = 'polishing' THEN status ELSE 'ready' END
     WHERE status_id = ?`,
  ).run(text, key);
}

// A crash mid-job would leave 'polishing' rows that no in-flight job owns.
export function clearStalePolishing(db: DatabaseSync): void {
  db.prepare(`UPDATE drafts SET status = ${SETTLED_STATUS} WHERE status = 'polishing' AND text IS NOT NULL`).run();
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

const StoredVersionsSchema = z.array(DraftVersionSchema);

/** Reads the `json_group_array` built by VERSIONS_SUBQUERY. */
export function parseVersions(raw: string | null): DraftVersion[] {
  try {
    const parsed = StoredVersionsSchema.safeParse(JSON.parse(raw ?? '[]'));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export const VERSIONS_SUBQUERY = (keyColumn: string): string => `(SELECT json_group_array(json_object(
    'id', v.id, 'text', v.text, 'status', v.status, 'violations', json(v.violations)))
  FROM (SELECT * FROM draft_versions WHERE draft_key = ${keyColumn} ORDER BY id) v)`;
