import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CapturedPost } from '@xc/shared';
import { openDb } from './db';
import { ingestPosts, listFlaggedPosts, prunePosts, setReplied } from './posts';
import type { PrefilterRules } from './triage/prefilter';

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 0, 10);
const rules: PrefilterRules = { handle: 'me', watchlist: ['vip'], maxAgeHours: 24, mentionMaxAgeHours: 72, minEngagement: 0, minFlagScore: 80 };

const metrics = { replies: 0, reposts: 0, likes: 0, views: 0 };
const post = (id: number, ageHours: number): CapturedPost => ({
  statusId: String(id),
  authorName: 'V',
  authorHandle: 'vip',
  text: `post ${id}`,
  postedAt: new Date(NOW - ageHours * HOUR).toISOString(),
  metrics,
  isReply: false,
  replyTo: [],
  quotedStatusId: null,
  avatarUrl: null,
});

describe('listFlaggedPosts', () => {
  it('fills the page with the newest eligible posts even when more stale must-flag rows sit above them', () => {
    const db = openDb(mkdtempSync(join(tmpdir(), 'xc-posts-')));
    ingestPosts(db, [post(1, 1), post(2, 2)], NOW, 'me');
    const stale = Array.from({ length: 450 }, (_, i) => post(100 + i, 30));
    ingestPosts(db, stale, NOW, 'me');
    db.exec(`INSERT INTO triage (status_id, must_flag, triaged_at) SELECT status_id, 'watchlist', 0 FROM posts`);

    const ids = listFlaggedPosts(db, 2, undefined, rules, NOW).posts.map((p) => p.statusId);
    expect(ids).toEqual(['2', '1']);
  });

  it('orders To reply newest flagged first (manual flag time, else triage time, else capture), ignoring score', () => {
    const db = openDb(mkdtempSync(join(tmpdir(), 'xc-posts-')));
    ingestPosts(db, [post(1, 1), post(2, 1), post(3, 1), post(4, 1), post(5, 1)], NOW, 'me');
    db.exec(`INSERT INTO triage (status_id, score, must_flag, triaged_at) VALUES ('1', 99, 'watchlist', 300), ('2', 10, 'watchlist', 100), ('4', 99, 'watchlist', 200)`);

    const ids = listFlaggedPosts(db, 10, undefined, rules, NOW).posts.map((p) => p.statusId);
    expect(ids).toEqual(['5', '3', '1', '4', '2']);
  });

  it('puts a manual flag at its flag time and drops reply-worthy posts past the age limit', () => {
    const db = openDb(mkdtempSync(join(tmpdir(), 'xc-posts-')));
    ingestPosts(db, [post(1, 1), post(2, 30), post(3, 30), post(4, 1)], NOW, 'me');
    db.exec(`INSERT INTO triage (status_id, score, reply_worthy, triaged_at) VALUES ('1', 85, 1, 100), ('2', 90, 1, 100), ('4', 85, 1, 200)`);
    db.exec(`UPDATE posts SET manual_flag_at = 500 WHERE status_id IN ('1', '3')`);

    const ids = listFlaggedPosts(db, 10, undefined, rules, NOW).posts.map((p) => p.statusId);
    expect(ids).toEqual(['3', '1', '4']);
  });

  it('moves replied posts to Replied (newest replied first), exempt from age limits, with counts', () => {
    const db = openDb(mkdtempSync(join(tmpdir(), 'xc-posts-')));
    ingestPosts(db, [post(1, 1), post(2, 1), post(3, 30)], NOW, 'me');
    expect(setReplied(db, '1', true, 100)).toBe(true);
    expect(setReplied(db, '3', true, 200)).toBe(true);
    expect(setReplied(db, 'nope', true, 300)).toBe(false);

    const toReply = listFlaggedPosts(db, 10, undefined, rules, NOW);
    expect(toReply.posts.map((p) => p.statusId)).toEqual(['2']);
    expect(toReply.counts).toEqual({ toReply: 1, replied: 2 });
    const replied = listFlaggedPosts(db, 10, undefined, rules, NOW, 'replied');
    expect(replied.posts.map((p) => [p.statusId, p.repliedAt])).toEqual([['3', 200], ['1', 100]]);

    setReplied(db, '1', true, 999);
    expect(listFlaggedPosts(db, 10, undefined, rules, NOW, 'replied').posts.map((p) => p.repliedAt)).toEqual([200, 100]);
    setReplied(db, '1', false, 1000);
    expect(listFlaggedPosts(db, 10, undefined, rules, NOW).posts.map((p) => p.statusId)).toEqual(['2', '1']);
  });

  it('keeps replied posts through the 30-day prune', () => {
    const db = openDb(mkdtempSync(join(tmpdir(), 'xc-posts-')));
    ingestPosts(db, [post(1, 1), post(2, 1)], NOW, 'me');
    setReplied(db, '1', true, NOW);
    prunePosts(db, NOW + 31 * 24 * HOUR);
    const left = db.prepare('SELECT status_id FROM posts').all() as { status_id: string }[];
    expect(left.map((r) => r.status_id)).toEqual(['1']);
  });
});

describe('prunePosts idea drafts', () => {
  it('removes versions and drafts of ideas whose digest is gone, keeping live ideas and post drafts', () => {
    const db = openDb(mkdtempSync(join(tmpdir(), 'xc-posts-')));
    db.exec(`INSERT INTO digests (id, bucket, trends, ideas, created_at) VALUES (7, 1, '[]', '[]', 0)`);
    const keys = ['idea-7-0', 'idea-70-1', 'idea-3-2', '42'];
    for (const key of keys) {
      db.prepare(`INSERT INTO drafts (status_id, kind, text, status, created_at) VALUES (?, 'manual', 't', 'ready', 0)`).run(key);
      db.prepare(`INSERT INTO draft_versions (draft_key, text, status, created_at) VALUES (?, 't', 'ready', 0)`).run(key);
    }

    prunePosts(db, NOW);
    const versionKeys = db.prepare('SELECT draft_key FROM draft_versions ORDER BY draft_key').all() as { draft_key: string }[];
    const draftKeys = db.prepare('SELECT status_id FROM drafts ORDER BY status_id').all() as { status_id: string }[];
    expect(versionKeys.map((r) => r.draft_key)).toEqual(['42', 'idea-7-0']);
    expect(draftKeys.map((r) => r.status_id)).toEqual(['42', 'idea-7-0']);
  });
});
