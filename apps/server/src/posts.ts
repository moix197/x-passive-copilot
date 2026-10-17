import type { DatabaseSync } from 'node:sqlite';
import type { CapturedPost, MustFlag, PolishInfo, PostBatchResult, PostListResponse, StoredPost } from '@xc/shared';
import { parseViolations, type DraftKind, type DraftStatus } from './polish/drafts-store';
import { checkReply, ruleNames } from './polish/guard';

const PRUNE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export function prunePosts(db: DatabaseSync, now: number): void {
  const cutoff = now - PRUNE_AFTER_MS;
  db.prepare('DELETE FROM drafts WHERE status_id IN (SELECT status_id FROM posts WHERE captured_at < ?)').run(cutoff);
  db.prepare('DELETE FROM triage WHERE status_id IN (SELECT status_id FROM posts WHERE captured_at < ?)').run(cutoff);
  db.prepare('DELETE FROM posts WHERE captured_at < ?').run(cutoff);
}

function updateMetrics(db: DatabaseSync, post: CapturedPost): boolean {
  const { replies, reposts, likes, views } = post.metrics;
  const result = db
    .prepare('UPDATE posts SET replies = ?, reposts = ?, likes = ?, views = ? WHERE status_id = ?')
    .run(replies, reposts, likes, views, post.statusId);
  return Number(result.changes) > 0;
}

function insertPost(db: DatabaseSync, post: CapturedPost, now: number): void {
  const m = post.metrics;
  db.prepare(
    `INSERT INTO posts (status_id, author_name, author_handle, text, posted_at, replies, reposts,
       likes, views, is_reply, quoted_status_id, captured_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    post.statusId, post.authorName, post.authorHandle, post.text, post.postedAt,
    m.replies, m.reposts, m.likes, m.views, post.isReply ? 1 : 0, post.quotedStatusId, now,
  );
}

export function ingestPosts(db: DatabaseSync, posts: CapturedPost[], now: number): PostBatchResult {
  const result: PostBatchResult = { accepted: 0, duplicates: 0 };
  db.exec('BEGIN');
  try {
    for (const post of posts) {
      if (updateMetrics(db, post)) {
        result.duplicates += 1;
      } else {
        insertPost(db, post, now);
        result.accepted += 1;
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return result;
}

interface PostRow {
  seq: number;
  status_id: string;
  author_name: string;
  author_handle: string;
  text: string;
  posted_at: string | null;
  replies: number;
  reposts: number;
  likes: number;
  views: number;
  is_reply: number;
  quoted_status_id: string | null;
  captured_at: number;
  t_status_id: string | null;
  score: number | null;
  reason: string | null;
  rough_draft: string | null;
  reply_worthy: number | null;
  skip_reason: string | null;
  must_flag: MustFlag | null;
  error: string | null;
  d_status: DraftStatus | null;
  d_kind: DraftKind | null;
  d_text: string | null;
  d_violations: string | null;
  d_error: string | null;
}

export interface PolishContext {
  threshold: number;
  capReached: boolean;
}

const NO_POLISH_CONTEXT: PolishContext = { threshold: Number.POSITIVE_INFINITY, capReached: false };

function toTriage(row: PostRow): StoredPost['triage'] {
  if (row.t_status_id === null) return null;
  return {
    score: row.score,
    reason: row.reason,
    roughDraft: row.rough_draft,
    replyWorthy: row.reply_worthy === 1,
    skipReason: row.skip_reason,
    mustFlag: row.must_flag,
    error: row.error,
    roughDraftWarnings: row.rough_draft ? ruleNames(checkReply(row.rough_draft, row.text)) : [],
  };
}

function toPolish(row: PostRow, ctx: PolishContext): PolishInfo | null {
  if (row.d_status) {
    return {
      status: row.d_status,
      text: row.d_text,
      violations: parseViolations(row.d_violations),
      topPick: row.d_kind === 'auto',
      error: row.d_error,
    };
  }
  const eligible = ctx.capReached && row.score !== null && row.score >= ctx.threshold;
  const worthy = row.reply_worthy === 1 || row.must_flag !== null;
  return eligible && worthy
    ? { status: 'cap_reached', text: null, violations: [], topPick: false, error: null }
    : null;
}

function toStoredPost(row: PostRow, ctx: PolishContext): StoredPost {
  return {
    seq: row.seq,
    statusId: row.status_id,
    authorName: row.author_name,
    authorHandle: row.author_handle,
    text: row.text,
    postedAt: row.posted_at,
    metrics: { replies: row.replies, reposts: row.reposts, likes: row.likes, views: row.views },
    isReply: row.is_reply === 1,
    quotedStatusId: row.quoted_status_id,
    capturedAt: row.captured_at,
    triage: toTriage(row),
    polish: toPolish(row, ctx),
  };
}

const SELECT_WITH_TRIAGE = `SELECT p.*, t.status_id AS t_status_id, t.score, t.reason, t.rough_draft,
  t.reply_worthy, t.skip_reason, t.must_flag, t.error,
  d.status AS d_status, d.kind AS d_kind, d.text AS d_text, d.violations AS d_violations, d.error AS d_error
  FROM posts p LEFT JOIN triage t ON t.status_id = p.status_id
  LEFT JOIN drafts d ON d.status_id = p.status_id`;

export function listPosts(
  db: DatabaseSync,
  limit: number,
  before: number | null,
  ctx: PolishContext = NO_POLISH_CONTEXT,
): PostListResponse {
  const rows = db
    .prepare(`${SELECT_WITH_TRIAGE} WHERE p.seq < ? ORDER BY p.seq DESC LIMIT ?`)
    .all(before ?? Number.MAX_SAFE_INTEGER, limit) as unknown as PostRow[];
  const posts = rows.map((row) => toStoredPost(row, ctx));
  const last = posts[posts.length - 1];
  return { posts, nextBefore: posts.length === limit && last ? last.seq : null };
}

export function listFlaggedPosts(
  db: DatabaseSync,
  limit: number,
  ctx: PolishContext = NO_POLISH_CONTEXT,
): PostListResponse {
  const rows = db
    .prepare(
      `${SELECT_WITH_TRIAGE} WHERE t.must_flag IS NOT NULL OR t.reply_worthy = 1
       ORDER BY COALESCE(t.score, 0) DESC, p.seq DESC LIMIT ?`,
    )
    .all(limit) as unknown as PostRow[];
  return { posts: rows.map((row) => toStoredPost(row, ctx)), nextBefore: null };
}

export function listUntriagedPosts(db: DatabaseSync): StoredPost[] {
  const rows = db
    .prepare(`${SELECT_WITH_TRIAGE} WHERE t.status_id IS NULL ORDER BY p.seq`)
    .all() as unknown as PostRow[];
  return rows.map((row) => toStoredPost(row, NO_POLISH_CONTEXT));
}

export function getPost(db: DatabaseSync, statusId: string): StoredPost | null {
  const row = db.prepare(`${SELECT_WITH_TRIAGE} WHERE p.status_id = ?`).get(statusId) as unknown as
    | PostRow
    | undefined;
  return row ? toStoredPost(row, NO_POLISH_CONTEXT) : null;
}

export function listAutoPolishCandidates(db: DatabaseSync, threshold: number): StoredPost[] {
  const rows = db
    .prepare(
      `${SELECT_WITH_TRIAGE} WHERE d.status_id IS NULL AND t.score >= ?
       AND (t.reply_worthy = 1 OR t.must_flag IS NOT NULL) ORDER BY t.score DESC, p.seq DESC`,
    )
    .all(threshold) as unknown as PostRow[];
  return rows.map((row) => toStoredPost(row, NO_POLISH_CONTEXT));
}
