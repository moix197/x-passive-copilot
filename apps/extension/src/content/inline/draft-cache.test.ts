import type { StoredPost } from '@xc/shared/types';
import { describe, expect, it } from 'vitest';
import { BUSY_REFRESH_MS, forgetOld, idsToFetch, markStale, nextRefreshMs, REFRESH_MS, keepAfterFailedLookup, storeLookup, type DraftCache } from './draft-cache';

const post = (statusId: string, polishing = false) =>
  ({ statusId, polish: polishing ? { status: 'polishing' } : null, triage: null }) as unknown as StoredPost;
const pendingPost = (statusId: string) =>
  ({ statusId, polish: null, triage: { score: null, error: null, skipReason: null, roughDraft: null } }) as unknown as StoredPost;
const answer = (posts: StoredPost[], replied: string[] = [], flaggable: string[] = []) => ({ posts, replied, flaggable });

describe('idsToFetch', () => {
  it('asks for unknown ids once, deduped and capped at one request', () => {
    expect(idsToFetch(['1', '2', '1'], new Map(), 0)).toEqual(['1', '2']);
    const many = Array.from({ length: 150 }, (_, i) => String(i));
    expect(idsToFetch(many, new Map(), 0)).toHaveLength(100);
  });

  it('asks again only once an answer is older than its interval, sooner while polishing', () => {
    const cache: DraftCache = new Map();
    storeLookup(cache, ['1', '2', '3'], answer([post('1'), post('2', true)]), 1000);
    expect(idsToFetch(['1', '2', '3'], cache, 1000 + BUSY_REFRESH_MS - 1)).toEqual([]);
    expect(idsToFetch(['1', '2', '3'], cache, 1000 + BUSY_REFRESH_MS)).toEqual(['2']);
    expect(idsToFetch(['1', '2', '3'], cache, 1000 + REFRESH_MS)).toEqual(['1', '2', '3']);
  });

  it('asks right away for an entry marked stale after an action', () => {
    const cache: DraftCache = new Map();
    storeLookup(cache, ['1'], answer([post('1')]), 1000);
    markStale(cache, '1');
    expect(idsToFetch(['1'], cache, 1001)).toEqual(['1']);
    expect(cache.get('1')?.post?.statusId).toBe('1');
  });
});

describe('nextRefreshMs', () => {
  it('waits for the next due visible entry, never longer than the refresh interval', () => {
    const cache: DraftCache = new Map();
    storeLookup(cache, ['1', '2'], answer([post('1'), post('2', true)]), 1000);
    expect(nextRefreshMs(['1'], cache, 1000)).toBe(REFRESH_MS);
    expect(nextRefreshMs(['1', '2'], cache, 1500)).toBe(BUSY_REFRESH_MS - 500);
    expect(nextRefreshMs(['9'], cache, 1500)).toBe(0);
    expect(nextRefreshMs([], cache, 1500)).toBe(REFRESH_MS);
  });
});

describe('storeLookup and forgetOld', () => {
  it('stores null for asked ids the server left out, and forgets entries after ten minutes', () => {
    const cache: DraftCache = new Map();
    storeLookup(cache, ['1', '2'], answer([post('1')]), 0);
    expect(cache.get('2')).toEqual({ post: null, mark: null, at: 0 });
    forgetOld(cache, 10 * 60_000 + 1);
    expect(cache.size).toBe(0);
  });
});

describe('marks and failed lookups', () => {
  it('marks replied and flaggable ids, and follows a post waiting for triage closely', () => {
    const cache: DraftCache = new Map();
    storeLookup(cache, ['1', '2', '3', '4'], answer([pendingPost('1')], ['2'], ['3']), 0);
    expect([...cache.values()].map((e) => e.mark)).toEqual([null, 'replied', 'flaggable', null]);
    expect(idsToFetch(['1', '3'], cache, BUSY_REFRESH_MS)).toEqual(['1']);
  });

  it('keeps the shown answer after a failed lookup and waits a full interval', () => {
    const cache: DraftCache = new Map();
    storeLookup(cache, ['1'], answer([], [], ['1']), 0);
    markStale(cache, '1');
    keepAfterFailedLookup(cache, ['1', '2'], 500);
    expect(cache.get('1')).toEqual({ post: null, mark: 'flaggable', at: 500 });
    expect(cache.get('2')).toEqual({ post: null, mark: null, at: 500 });
    expect(idsToFetch(['1', '2'], cache, 500 + REFRESH_MS - 1)).toEqual([]);
  });
});
