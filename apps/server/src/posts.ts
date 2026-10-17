import type { DatabaseSync } from 'node:sqlite';
import type { CapturedPost, PostBatchResult, PostListResponse, StoredPost } from '@xc/shared';

const PRUNE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export function prunePosts(db: DatabaseSync, now: number): void {
  db.prepare('DELETE FROM posts WHERE captured_at < ?').run(now - PRUNE_AFTER_MS);
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
}

function toStoredPost(row: PostRow): StoredPost {
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
  };
}

export function listPosts(db: DatabaseSync, limit: number, before: number | null): PostListResponse {
  const rows = db
    .prepare('SELECT * FROM posts WHERE seq < ? ORDER BY seq DESC LIMIT ?')
    .all(before ?? Number.MAX_SAFE_INTEGER, limit) as unknown as PostRow[];
  const posts = rows.map(toStoredPost);
  const last = posts[posts.length - 1];
  return { posts, nextBefore: posts.length === limit && last ? last.seq : null };
}
