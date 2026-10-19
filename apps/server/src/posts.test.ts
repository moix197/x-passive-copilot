import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CapturedPost } from '@xc/shared';
import { openDb } from './db';
import { ingestPosts, listFlaggedPosts } from './posts';
import type { PrefilterRules } from './triage/prefilter';

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 0, 10);
const rules: PrefilterRules = { handle: 'me', watchlist: ['vip'], maxAgeHours: 24, mentionMaxAgeHours: 72, minEngagement: 0 };

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

  it('orders by newest captured first regardless of triage score', () => {
    const db = openDb(mkdtempSync(join(tmpdir(), 'xc-posts-')));
    ingestPosts(db, [post(1, 1), post(2, 1), post(3, 1)], NOW, 'me');
    db.exec(`INSERT INTO triage (status_id, score, must_flag, triaged_at) VALUES ('1', 99, 'watchlist', 0), ('2', 10, 'watchlist', 0)`);

    const ids = listFlaggedPosts(db, 10, undefined, rules, NOW).posts.map((p) => p.statusId);
    expect(ids).toEqual(['3', '2', '1']);
  });
});
