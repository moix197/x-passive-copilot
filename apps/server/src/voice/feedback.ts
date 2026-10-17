import type { DatabaseSync } from 'node:sqlite';
import type { FeedbackRequest } from '@xc/shared';
import { checkReply, ruleNames } from '../polish/guard';
import { isIdeaDraftKey, replySource } from '../polish/polish';
import { getPost } from '../posts';

export type FeedbackOutcome = { ok: true } | { ok: false; status: 404 | 422; error: string };

interface ExampleRow {
  text: string;
  polarity: 'positive' | 'negative';
}

export function listFeedbackExamples(db: DatabaseSync): { positives: string[]; negatives: string[] } {
  const rows = db
    .prepare('SELECT text, polarity FROM examples ORDER BY created_at DESC, id DESC')
    .all() as unknown as ExampleRow[];
  const textsOf = (polarity: ExampleRow['polarity']) => rows.filter((r) => r.polarity === polarity).map((r) => r.text);
  return { positives: textsOf('positive'), negatives: textsOf('negative') };
}

function readDraftText(db: DatabaseSync, draftId: string): string | null {
  const row = db.prepare('SELECT text FROM drafts WHERE status_id = ?').get(draftId) as
    | { text: string | null }
    | undefined;
  return row?.text ?? null;
}

function guardSource(db: DatabaseSync, draftId: string): string {
  if (isIdeaDraftKey(draftId)) return '';
  const post = getPost(db, draftId);
  return post ? replySource(post) : '';
}

function upsertExample(db: DatabaseSync, draftId: string, text: string, polarity: string, now: number): void {
  db.prepare(
    `INSERT INTO examples (draft_id, text, polarity, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(draft_id) DO UPDATE SET text = excluded.text, polarity = excluded.polarity,
       created_at = excluded.created_at`,
  ).run(draftId, text, polarity, now);
}

function guardText(db: DatabaseSync, draftId: string, text: string): FeedbackOutcome {
  const rules = ruleNames(checkReply(text, guardSource(db, draftId)));
  return rules.length ? { ok: false, status: 422, error: `guard: ${rules.join(', ')}` } : { ok: true };
}

export function recordFeedback(
  db: DatabaseSync,
  draftId: string,
  feedback: FeedbackRequest,
  now: number,
): FeedbackOutcome {
  const draftText = readDraftText(db, draftId);
  if (draftText === null) return { ok: false, status: 404, error: 'not found' };
  const text = feedback.kind === 'edit' ? (feedback.text ?? '') : draftText;
  if (feedback.kind === 'down') {
    upsertExample(db, draftId, text, 'negative', now);
    return { ok: true };
  }
  const verdict = guardText(db, draftId, text);
  if (feedback.kind === 'edit' && !verdict.ok) return verdict;
  // A copied/liked draft that breaks the guard is not a style example worth learning from.
  if (verdict.ok) upsertExample(db, draftId, text, 'positive', now);
  return { ok: true };
}
