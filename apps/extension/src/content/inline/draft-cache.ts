import { MAX_INLINE_IDS, type StoredPost } from '@xc/shared/types';

/** null: the server said the post is not in To reply (or the lookup failed). */
export interface CacheEntry {
  post: StoredPost | null;
  at: number;
  /** Set after a user action, so the next sync asks again whatever the age. */
  stale?: boolean;
}

export type DraftCache = Map<string, CacheEntry>;

export const REFRESH_MS = 15_000;
/** While a polish or regenerate runs, its card follows the server closely. */
export const BUSY_REFRESH_MS = 2_000;
const FORGET_MS = 10 * 60_000;

export const isBusy = (entry: CacheEntry | undefined): boolean => entry?.post?.polish?.status === 'polishing';

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

export function storeLookup(cache: DraftCache, asked: string[], posts: StoredPost[], now: number): void {
  const byId = new Map(posts.map((post) => [post.statusId, post]));
  for (const id of asked) cache.set(id, { post: byId.get(id) ?? null, at: now });
}

/** Marks an entry due now, e.g. right after the user asked for a new version. */
export function markStale(cache: DraftCache, statusId: string): void {
  const entry = cache.get(statusId);
  if (entry) cache.set(statusId, { ...entry, stale: true });
}

export function forgetOld(cache: DraftCache, now: number): void {
  for (const [id, entry] of cache) if (now - entry.at > FORGET_MS) cache.delete(id);
}
