import type { AppConfig, MustFlag, StoredPost } from '@xc/shared';

const HOUR_MS = 60 * 60 * 1000;

export interface PrefilterRules {
  handle: string;
  watchlist: string[];
  maxAgeHours: number;
  minEngagement: number;
}

export type PrefilterResult =
  | { action: 'triage'; mustFlag?: MustFlag }
  | { action: 'skip'; reason: string };

type PrefilterPost = Pick<StoredPost, 'authorHandle' | 'text' | 'postedAt' | 'metrics'>;

export function rulesFromConfig(config: AppConfig): PrefilterRules {
  return {
    handle: config.handle,
    watchlist: config.watchlist,
    maxAgeHours: config.triage.maxAgeHours,
    minEngagement: config.triage.minEngagement,
  };
}

function mentionsHandle(text: string, handle: string): boolean {
  const escaped = handle.replace(/[^A-Za-z0-9_]/g, '');
  if (!escaped) return false;
  return new RegExp(`(^|[^A-Za-z0-9_])@${escaped}(?![A-Za-z0-9_])`, 'i').test(text);
}

function onWatchlist(authorHandle: string, watchlist: string[]): boolean {
  const author = authorHandle.toLowerCase();
  return watchlist.some((entry) => entry.replace(/^@/, '').toLowerCase() === author);
}

function ageHours(postedAt: string | null, now: number): number | null {
  const time = postedAt ? Date.parse(postedAt) : Number.NaN;
  return Number.isNaN(time) ? null : (now - time) / HOUR_MS;
}

function engagement(m: PrefilterPost['metrics']): number {
  return m.likes + m.reposts + m.replies;
}

function mustFlagFor(post: PrefilterPost, rules: PrefilterRules): MustFlag | undefined {
  if (mentionsHandle(post.text, rules.handle)) return 'mention';
  if (onWatchlist(post.authorHandle, rules.watchlist)) return 'watchlist';
  return undefined;
}

export function prefilter(post: PrefilterPost, rules: PrefilterRules, now: number): PrefilterResult {
  const mustFlag = mustFlagFor(post, rules);
  if (mustFlag) return { action: 'triage', mustFlag };
  const age = ageHours(post.postedAt, now);
  if (age !== null && age > rules.maxAgeHours) return { action: 'skip', reason: `older than ${rules.maxAgeHours}h` };
  if (engagement(post.metrics) < rules.minEngagement) {
    return { action: 'skip', reason: `engagement below ${rules.minEngagement}` };
  }
  return { action: 'triage' };
}
