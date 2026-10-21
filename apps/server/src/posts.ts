import type { DatabaseSync } from 'node:sqlite';
import {
  CapturedPostSchema,
  type CapturedPost,
  type FlaggedCounts,
  type FlaggedFeed,
  type MustFlag,
  type PolishInfo,
  type PostBatchResult,
  type PostListResponse,
  type StoredPost,
} from '@xc/shared';
import {
  parseVersions,
  parseViolations,
  VERSIONS_SUBQUERY,
  type DraftKind,
  type DraftStatus,
} from './polish/drafts-store';
import { checkReply, ruleNames } from './polish/guard';
import { activeMustFlag, isOwnAuthor, isWithinAgeLimit, type PrefilterRules } from './triage/prefilter';

const PRUNE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const PRUNABLE = 'SELECT status_id FROM posts WHERE captured_at < ? AND is_own = 0 AND replied_at IS NULL';
const INGEST_COUNTER = { own: 'ingest:own', nonOwn: 'ingest:non_own' } as const;
// Idea draft keys are `idea-<digestId>-<index>`; keys whose digest row no longer exists are orphans.
const isOrphanIdeaKey = (column: string) =>
  `${column} LIKE 'idea-%' AND CAST(substr(${column}, 6, instr(substr(${column}, 6), '-') - 1) AS INTEGER) NOT IN (SELECT id FROM digests)`;

// Own posts are voice samples and replied posts are the user's history, so both outlive the prune window.
export function prunePosts(db: DatabaseSync, now: number): void {
  const cutoff = now - PRUNE_AFTER_MS;
  db.prepare(`DELETE FROM draft_versions WHERE draft_key IN (${PRUNABLE})`).run(cutoff);
  db.prepare(`DELETE FROM drafts WHERE status_id IN (${PRUNABLE})`).run(cutoff);
  db.prepare(`DELETE FROM triage WHERE status_id IN (${PRUNABLE})`).run(cutoff);
  db.prepare('DELETE FROM posts WHERE captured_at < ? AND is_own = 0 AND replied_at IS NULL').run(cutoff);
  pruneOrphanIdeaDrafts(db);
}

function pruneOrphanIdeaDrafts(db: DatabaseSync): void {
  db.exec(`DELETE FROM draft_versions WHERE ${isOrphanIdeaKey('draft_key')}`);
  db.exec(`DELETE FROM drafts WHERE ${isOrphanIdeaKey('status_id')}`);
}

// Monotonic: digest buckets and voice regen must keep advancing after pruning shrinks the table.
export function seedIngestCounters(db: DatabaseSync): void {
  const seed = db.prepare('INSERT OR IGNORE INTO meta (key, value) SELECT ?, COUNT(*) FROM posts WHERE is_own = ?');
  seed.run(INGEST_COUNTER.own, 1);
  seed.run(INGEST_COUNTER.nonOwn, 0);
}

export function readIngestCount(db: DatabaseSync, kind: keyof typeof INGEST_COUNTER): number {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(INGEST_COUNTER[kind]) as { value: number } | undefined;
  return row?.value ?? 0;
}

function bumpIngestCount(db: DatabaseSync, own: boolean): void {
  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, 1) ON CONFLICT(key) DO UPDATE SET value = value + 1',
  ).run(own ? INGEST_COUNTER.own : INGEST_COUNTER.nonOwn);
}

function parseReplyTo(raw: string): string[] {
  try {
    const parsed = CapturedPostSchema.shape.replyTo.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

function updateMetrics(db: DatabaseSync, post: CapturedPost): boolean {
  const { replies, reposts, likes, views } = post.metrics;
  // Re-captures also fill in an avatar that an older capture (or extension version) lacked.
  const result = db
    .prepare(
      `UPDATE posts SET replies = ?, reposts = ?, likes = ?, views = ?, avatar_url = COALESCE(?, avatar_url)
       WHERE status_id = ?`,
    )
    .run(replies, reposts, likes, views, post.avatarUrl, post.statusId);
  return Number(result.changes) > 0;
}

function insertPost(db: DatabaseSync, post: CapturedPost, now: number, ownHandle: string): void {
  const m = post.metrics;
  const own = isOwnAuthor(post.authorHandle, ownHandle);
  db.prepare(
    `INSERT INTO posts (status_id, author_name, author_handle, text, posted_at, replies, reposts,
       likes, views, is_reply, quoted_status_id, captured_at, is_own, reply_to, avatar_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    post.statusId, post.authorName, post.authorHandle, post.text, post.postedAt,
    m.replies, m.reposts, m.likes, m.views, post.isReply ? 1 : 0, post.quotedStatusId, now,
    own ? 1 : 0, JSON.stringify(post.replyTo), post.avatarUrl,
  );
  bumpIngestCount(db, own);
}

export function ingestPosts(
  db: DatabaseSync,
  posts: CapturedPost[],
  now: number,
  ownHandle: string,
): PostBatchResult {
  const result: PostBatchResult = { accepted: 0, duplicates: 0 };
  db.exec('BEGIN');
  try {
    for (const post of posts) {
      if (updateMetrics(db, post)) {
        result.duplicates += 1;
      } else {
        insertPost(db, post, now, ownHandle);
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
  reply_to: string;
  quoted_status_id: string | null;
  avatar_url: string | null;
  captured_at: number;
  replied_at: number | null;
  copied_at: number | null;
  manual_flag_at: number | null;
  t_status_id: string | null;
  t_triaged_at: number | null;
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
  d_selected_version: number | null;
  d_versions: string | null;
  d_feedback: 'up' | 'down' | null;
  t_feedback: 'up' | 'down' | null;
}

export interface PolishContext {
  threshold: number;
  capReached: boolean;
}

const NO_POLISH_CONTEXT: PolishContext = { threshold: Number.POSITIVE_INFINITY, capReached: false };

// The manual mark lives on the post, so no later triage verdict can unflag it.
const rowMustFlag = (row: PostRow): MustFlag | null => (row.manual_flag_at !== null ? 'manual' : row.must_flag);

function toTriage(row: PostRow): StoredPost['triage'] {
  if (row.t_status_id === null) return null;
  return {
    score: row.score,
    reason: row.reason,
    roughDraft: row.rough_draft,
    replyWorthy: row.reply_worthy === 1,
    skipReason: row.skip_reason,
    mustFlag: rowMustFlag(row),
    error: row.error,
    roughDraftWarnings: row.rough_draft ? ruleNames(checkReply(row.rough_draft, row.text)) : [],
    feedback: row.t_feedback,
  };
}

function toPolish(row: PostRow, ctx: PolishContext): PolishInfo | null {
  if (row.d_status) {
    const versions = parseVersions(row.d_versions);
    return {
      status: row.d_status,
      text: row.d_text,
      violations: parseViolations(row.d_violations),
      topPick: row.d_kind === 'auto',
      error: row.d_error,
      versions,
      // Backfilled drafts have no stored selection; their only version is the selected one.
      selectedVersion: row.d_selected_version ?? versions[versions.length - 1]?.id ?? null,
      feedback: row.d_feedback,
    };
  }
  const eligible = ctx.capReached && row.score !== null && row.score >= ctx.threshold;
  const worthy = row.reply_worthy === 1 || rowMustFlag(row) !== null;
  return eligible && worthy
    ? { status: 'cap_reached', text: null, violations: [], topPick: false, error: null, versions: [], selectedVersion: null, feedback: null }
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
    replyTo: parseReplyTo(row.reply_to),
    quotedStatusId: row.quoted_status_id,
    avatarUrl: row.avatar_url,
    capturedAt: row.captured_at,
    repliedAt: row.replied_at,
    copiedAt: row.copied_at,
    manualFlaggedAt: row.manual_flag_at,
    triage: toTriage(row),
    polish: toPolish(row, ctx),
  };
}

const SELECT_WITH_TRIAGE = `SELECT p.*, t.status_id AS t_status_id, t.triaged_at AS t_triaged_at, t.score, t.reason, t.rough_draft,
  t.reply_worthy, t.skip_reason, t.must_flag, t.error,
  d.status AS d_status, d.kind AS d_kind, d.text AS d_text, d.violations AS d_violations, d.error AS d_error,
  d.selected_version AS d_selected_version, ${VERSIONS_SUBQUERY('p.status_id')} AS d_versions,
  (SELECT CASE e.polarity WHEN 'positive' THEN 'up' ELSE 'down' END FROM examples e WHERE e.draft_id = d.status_id) AS d_feedback,
  (SELECT CASE e.polarity WHEN 'positive' THEN 'up' ELSE 'down' END FROM examples e WHERE e.draft_id = 'rough-' || p.status_id) AS t_feedback
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

const FLAGGED_BATCH = 200;

/** Untriaged (or triage-disabled) mention/watchlist posts: they must show in Flagged before triage. */
function asPendingMustFlag(post: StoredPost, rules: PrefilterRules, now: number): StoredPost | null {
  const mustFlag = activeMustFlag(post, rules, now);
  return mustFlag ? { ...post, triage: pendingTriage(mustFlag) } : null;
}

function pendingTriage(mustFlag: MustFlag): StoredPost['triage'] {
  return {
    score: null, reason: null, roughDraft: null, replyWorthy: false,
    skipReason: null, mustFlag, error: null, roughDraftWarnings: [], feedback: null,
  };
}

/** Stored rows hide once past their age limit (24h, mentions 3 days); a manual flag never ages out. */
function isStaleFlagged(post: StoredPost, rules: PrefilterRules | null, now: number): boolean {
  const mustFlag = post.triage?.mustFlag ?? undefined;
  return !!rules && !isWithinAgeLimit(post.postedAt, mustFlag, rules, now);
}

function eligibleFlagged(post: StoredPost, rules: PrefilterRules | null, now: number): StoredPost | null {
  if (post.triage) return isStaleFlagged(post, rules, now) ? null : post;
  if (post.manualFlaggedAt !== null) return { ...post, triage: pendingTriage('manual') };
  return rules ? asPendingMustFlag(post, rules, now) : null;
}

interface FlaggedEntry {
  post: StoredPost;
  /** When the post was flagged: by hand, else triaged, else (still pending) captured. */
  flaggedAt: number;
}

const flaggedAtOf = (row: PostRow): number => row.manual_flag_at ?? row.t_triaged_at ?? row.captured_at;

/** Newest flagged first; ties newest captured. */
function byNewestFlagged(a: FlaggedEntry, b: FlaggedEntry): number {
  return b.flaggedAt - a.flaggedAt || b.post.seq - a.post.seq;
}

const FLAGGED_WHERE = '(t.must_flag IS NOT NULL OR t.reply_worthy = 1 OR t.status_id IS NULL OR p.manual_flag_at IS NOT NULL)';

/** Every unreplied post still worth a reply. Stale rows drop out after the SQL page, so scan all pages. */
function collectToReply(db: DatabaseSync, ctx: PolishContext, rules: PrefilterRules | null, now: number): FlaggedEntry[] {
  const query = db.prepare(
    `${SELECT_WITH_TRIAGE} WHERE p.seq < ? AND p.replied_at IS NULL AND ${FLAGGED_WHERE} ORDER BY p.seq DESC LIMIT ?`,
  );
  const posts: FlaggedEntry[] = [];
  let before = Number.MAX_SAFE_INTEGER;
  for (;;) {
    const rows = query.all(before, FLAGGED_BATCH) as unknown as PostRow[];
    for (const row of rows) {
      const post = eligibleFlagged(toStoredPost(row, ctx), rules, now);
      if (post) posts.push({ post, flaggedAt: flaggedAtOf(row) });
    }
    const last = rows[rows.length - 1];
    if (rows.length < FLAGGED_BATCH || !last) return posts;
    before = last.seq;
  }
}

/** Replied posts keep showing whatever their age: they are exempt from the Flagged age limits. */
function listReplied(db: DatabaseSync, limit: number, ctx: PolishContext): StoredPost[] {
  const rows = db
    .prepare(`${SELECT_WITH_TRIAGE} WHERE p.replied_at IS NOT NULL ORDER BY p.replied_at DESC, p.seq DESC LIMIT ?`)
    .all(limit) as unknown as PostRow[];
  return rows.map((row) => toStoredPost(row, ctx));
}

function countReplied(db: DatabaseSync): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM posts WHERE replied_at IS NOT NULL').get() as { n: number };
  return row.n;
}

export function listFlaggedPosts(
  db: DatabaseSync,
  limit: number,
  ctx: PolishContext = NO_POLISH_CONTEXT,
  rules: PrefilterRules | null = null,
  now: number = Date.now(),
  feed: FlaggedFeed = 'to_reply',
): PostListResponse {
  const toReply = collectToReply(db, ctx, rules, now).sort(byNewestFlagged);
  const counts: FlaggedCounts = { toReply: toReply.length, replied: countReplied(db) };
  const posts = feed === 'replied' ? listReplied(db, limit, ctx) : toReply.slice(0, limit).map((entry) => entry.post);
  return { posts, nextBefore: null, counts };
}

/** The given posts that sit in To reply right now (same rules as the Flagged list), for inline drafts on x.com. */
export function listToReplyByIds(
  db: DatabaseSync,
  statusIds: string[],
  ctx: PolishContext,
  rules: PrefilterRules | null,
  now: number,
): StoredPost[] {
  if (statusIds.length === 0) return [];
  const marks = statusIds.map(() => '?').join(',');
  const rows = db
    .prepare(`${SELECT_WITH_TRIAGE} WHERE p.status_id IN (${marks}) AND p.replied_at IS NULL AND ${FLAGGED_WHERE}`)
    .all(...statusIds) as unknown as PostRow[];
  return rows.flatMap((row) => eligibleFlagged(toStoredPost(row, ctx), rules, now) ?? []);
}

export interface InlineLookup {
  posts: StoredPost[];
  replied: string[];
  flaggable: string[];
}

interface CapturedRow {
  status_id: string;
  is_own: number;
  replied_at: number | null;
}

function capturedRows(db: DatabaseSync, statusIds: string[]): CapturedRow[] {
  if (statusIds.length === 0) return [];
  const marks = statusIds.map(() => '?').join(',');
  return db
    .prepare(`SELECT status_id, is_own, replied_at FROM posts WHERE status_id IN (${marks})`)
    .all(...statusIds) as unknown as CapturedRow[];
}

/** For the x.com pills: the asked posts in To reply, the replied ones, and the captured rest that can be flagged by hand. */
export function lookupInlineStates(
  db: DatabaseSync,
  statusIds: string[],
  ctx: PolishContext,
  rules: PrefilterRules | null,
  now: number,
): InlineLookup {
  const posts = listToReplyByIds(db, statusIds, ctx, rules, now);
  const inToReply = new Set(posts.map((post) => post.statusId));
  const rows = capturedRows(db, statusIds);
  return {
    posts,
    replied: rows.filter((row) => row.replied_at !== null).map((row) => row.status_id),
    flaggable: rows
      .filter((row) => row.replied_at === null && row.is_own === 0 && !inToReply.has(row.status_id))
      .map((row) => row.status_id),
  };
}

/** Keeps the first flag time, so flagging again changes nothing. */
export function setManualFlag(db: DatabaseSync, statusId: string, now: number): boolean {
  const result = db.prepare('UPDATE posts SET manual_flag_at = COALESCE(manual_flag_at, ?) WHERE status_id = ?').run(now, statusId);
  return Number(result.changes) > 0;
}

/** Marking keeps the first replied time, so a later Copy on a replied card does not reorder it. */
export function setReplied(db: DatabaseSync, statusId: string, replied: boolean, now: number): boolean {
  const result = replied
    ? db.prepare('UPDATE posts SET replied_at = COALESCE(replied_at, ?) WHERE status_id = ?').run(now, statusId)
    : db.prepare('UPDATE posts SET replied_at = NULL WHERE status_id = ?').run(statusId);
  return Number(result.changes) > 0;
}

export function setCopied(db: DatabaseSync, statusId: string, now: number): boolean {
  const result = db.prepare('UPDATE posts SET copied_at = ? WHERE status_id = ?').run(now, statusId);
  return Number(result.changes) > 0;
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
