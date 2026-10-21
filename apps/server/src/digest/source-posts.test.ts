import { describe, expect, it } from 'vitest';
import { excerptOf, ideaSourceOf, selectSourcePosts, sourceRank, type SourceCandidate } from './source-posts';

const NOW = Date.parse('2026-10-21T12:00:00Z');
const HOUR = 3_600_000;

const candidate = (statusId: string, fields: Partial<SourceCandidate> = {}): SourceCandidate => ({
  statusId,
  authorHandle: 'someone',
  text: `plain post ${statusId}`,
  postedAt: new Date(NOW - 2 * HOUR).toISOString(),
  capturedAt: NOW - HOUR,
  score: null,
  likes: 10,
  reposts: 1,
  replies: 1,
  ...fields,
});

const rules = { now: NOW, maxAgeHours: 24, exclude: new Set<string>() };
const ids = (list: SourceCandidate[]) => list.map((c) => c.statusId);

describe('selectSourcePosts', () => {
  it('ranks by triage score, then engagement, with a bonus for crypto, eco and trading topics', () => {
    const list = [
      candidate('1', { score: 60 }),
      candidate('2', { score: 95 }),
      candidate('3', { score: 60, text: 'Robinhood Chain wallets are moving into the LONG eco' }),
      candidate('4', { score: 60, likes: 5000, reposts: 400 }),
    ];
    expect(ids(selectSourcePosts(list, rules))).toEqual(['2', '3', '4', '1']);
    expect(sourceRank(candidate('x'))).toBeGreaterThan(50);
  });

  it('drops stale posts (captured time when posted time is unknown), quoted ones and empty text', () => {
    const list = [
      candidate('1'),
      candidate('2', { postedAt: new Date(NOW - 30 * HOUR).toISOString() }),
      candidate('3', { postedAt: null, capturedAt: NOW - 30 * HOUR }),
      candidate('4', { postedAt: null, capturedAt: NOW - 3 * HOUR }),
      candidate('5'),
      candidate('6', { text: '   ' }),
    ];
    expect(ids(selectSourcePosts(list, { ...rules, exclude: new Set(['5']) }))).toEqual(['1', '4']);
  });

  it('is bounded to a small set', () => {
    const list = Array.from({ length: 20 }, (_, i) => candidate(String(i + 1)));
    expect(selectSourcePosts(list, rules)).toHaveLength(6);
    expect(selectSourcePosts(list, { ...rules, limit: 3 })).toHaveLength(3);
  });
});

describe('source excerpts', () => {
  it('are one short line without em dashes', () => {
    const long = `a — b\n\n${'x'.repeat(400)}`;
    expect(excerptOf(long)).toMatch(/^a, b x+$/);
    expect(excerptOf(long).length).toBe(200);
  });

  it('link to the post on x.com', () => {
    expect(ideaSourceOf(candidate('77', { authorHandle: 'alice', text: 'hi' }))).toEqual({
      statusId: '77',
      url: 'https://x.com/alice/status/77',
      authorHandle: 'alice',
      excerpt: 'hi',
    });
  });
});
