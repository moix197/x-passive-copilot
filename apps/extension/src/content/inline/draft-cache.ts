import { MAX_INLINE_IDS, type StoredPost, type ToReplyByIdsResponse } from '@xc/shared/types';
import { isTriagePending } from '../../drafts/current-draft';

/** Where a post outside To reply stands: replied, flaggable by hand, or nothing to show (not captured, own). */
export type PostMark = 'replied' | 'flaggable' | null;

/** post null: the server said the post is not in To reply (or the lookup failed). */
export interface CacheEntry {
  post: StoredPost | null;
  mark: PostMark;
  at: number;
  /** Set after a user action, so the next sync asks again whatever the age. */
  stale?: boolean;
}

export type DraftCache = Map<string, CacheEntry>;

export const REFRESH_MS = 15_000;
/** While a polish or regenerate runs, its card follows the server closely. */
export const BUSY_REFRESH_MS = 2_000;
const FORGET_MS = 10 * 60_000;

/** A polish running, or a flagged post waiting for triage: its pill follows the server closely. */
export function isBusy(entry: CacheEntry | undefined): boolean {
  const post = entry?.post;
  return Boolean(post && (post.polish?.status === 'polishing' || isTriagePending(post)));
}

const maxAge = (entry: CacheEntry): number => (entry.stale ? 0 : isBusy(entry) ? BUSY_REFRESH_MS : REFRESH_MS);

/** Visible ids never looked up, or whose answer is older than its refresh interval; one request's worth. */
export function idsToFetch(visible: string[], cache: DraftCache, now: number): string[] {
  const due = visible.filter((id) => {
    const entry = cache.get(id);
    return !entry || now - entry.at >= maxAge(entry);
  });
  return [...new Set(due)].slice(0, MAX_INLINE_IDS);
}

/** How long until the next visible entry is due, so one timer serves every card. */
export function nextRefreshMs(visible: string[], cache: DraftCache, now: number): number {
  const waits = visible.map((id) => {
    const entry = cache.get(id);
    return entry ? Math.max(0, entry.at + maxAge(entry) - now) : 0;
  });
  return Math.min(REFRESH_MS, ...waits);
}

export type LookupAnswer = Pick<ToReplyByIdsResponse, 'posts' | 'replied' | 'flaggable'>;

function markOf(id: string, answer: LookupAnswer): PostMark {
  if (answer.replied.includes(id)) return 'replied';
  return answer.flaggable.includes(id) ? 'flaggable' : null;
}

export function storeLookup(cache: DraftCache, asked: string[], answer: LookupAnswer, now: number): void {
  const byId = new Map(answer.posts.map((post) => [post.statusId, post]));
  for (const id of asked) cache.set(id, { post: byId.get(id) ?? null, mark: markOf(id, answer), at: now });
}

/** A failed lookup keeps what is shown and waits a full interval before asking again. */
export function keepAfterFailedLookup(cache: DraftCache, asked: string[], now: number): void {
  for (const id of asked) {
    const entry = cache.get(id);
    cache.set(id, { post: entry?.post ?? null, mark: entry?.mark ?? null, at: now });
  }
}

/** Marks an entry due now, e.g. right after the user asked for a new version. */
export function markStale(cache: DraftCache, statusId: string): void {
  const entry = cache.get(statusId);
  if (entry) cache.set(statusId, { ...entry, stale: true });
}

export function forgetOld(cache: DraftCache, now: number): void {
  for (const [id, entry] of cache) if (now - entry.at > FORGET_MS) cache.delete(id);
}
