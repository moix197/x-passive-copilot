import type { AppConfig, MustFlag, StoredPost } from '@xc/shared';

const HOUR_MS = 60 * 60 * 1000;

export interface PrefilterRules {
  handle: string;
  watchlist: string[];
  maxAgeHours: number;
  mentionMaxAgeHours: number;
  minEngagement: number;
  minFlagScore: number;
}

export type PrefilterResult =
  | { action: 'triage'; mustFlag?: MustFlag }
  | { action: 'skip'; reason: string };

type PrefilterPost = Pick<StoredPost, 'authorHandle' | 'text' | 'postedAt' | 'metrics' | 'replyTo'>;

export function rulesFromConfig(config: AppConfig): PrefilterRules {
  return {
    handle: config.handle,
    watchlist: config.watchlist,
    maxAgeHours: config.triage.maxAgeHours,
    mentionMaxAgeHours: config.triage.mentionMaxAgeHours,
    minEngagement: config.triage.minEngagement,
    minFlagScore: config.triage.minFlagScore,
  };
}

export function isOwnAuthor(authorHandle: string, handle: string): boolean {
  const own = handle.replace(/^@/, '').toLowerCase();
  return own !== '' && authorHandle.toLowerCase() === own;
}

function mentionsHandle(text: string, handle: string): boolean {
  const escaped = handle.replace(/[^A-Za-z0-9_]/g, '');
  if (!escaped) return false;
  return new RegExp(`(^|[^A-Za-z0-9_])@${escaped}(?![A-Za-z0-9_])`, 'i').test(text);
}

// X strips the leading @target from tweetText on replies; the parser captures them as replyTo.
function repliesToHandle(replyTo: string[], handle: string): boolean {
  return replyTo.some((target) => isOwnAuthor(target, handle));
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

export function mustFlagFor(post: PrefilterPost, rules: PrefilterRules): MustFlag | undefined {
  if (mentionsHandle(post.text, rules.handle) || repliesToHandle(post.replyTo, rules.handle)) return 'mention';
  if (onWatchlist(post.authorHandle, rules.watchlist)) return 'watchlist';
  return undefined;
}

export function ageLimitHours(mustFlag: MustFlag | undefined, rules: PrefilterRules): number {
  return mustFlag === 'mention' ? rules.mentionMaxAgeHours : rules.maxAgeHours;
}

/** Unknown postedAt counts as fresh; a post the user flagged by hand never ages out. */
export function isWithinAgeLimit(
  postedAt: string | null,
  mustFlag: MustFlag | undefined,
  rules: PrefilterRules,
  now: number,
): boolean {
  if (mustFlag === 'manual') return true;
  const age = ageHours(postedAt, now);
  return age === null || age <= ageLimitHours(mustFlag, rules);
}

/** Must-flag verdict that no longer applies once the post is past its age limit. */
export function activeMustFlag(post: PrefilterPost, rules: PrefilterRules, now: number): MustFlag | undefined {
  const mustFlag = mustFlagFor(post, rules);
  return mustFlag && isWithinAgeLimit(post.postedAt, mustFlag, rules, now) ? mustFlag : undefined;
}

export function prefilter(post: PrefilterPost, rules: PrefilterRules, now: number): PrefilterResult {
  if (isOwnAuthor(post.authorHandle, rules.handle)) return { action: 'skip', reason: 'own post' };
  const mustFlag = mustFlagFor(post, rules);
  if (!isWithinAgeLimit(post.postedAt, mustFlag, rules, now)) {
    return { action: 'skip', reason: `older than ${ageLimitHours(mustFlag, rules)}h` };
  }
  if (mustFlag) return { action: 'triage', mustFlag };
  if (engagement(post.metrics) < rules.minEngagement) {
    return { action: 'skip', reason: `engagement below ${rules.minEngagement}` };
  }
  return { action: 'triage' };
}
