import type { DatabaseSync } from 'node:sqlite';
import type { IdeaSource } from '@xc/shared';
import { replaceDashes } from '../text/dashes';
import { ageHours } from '../triage/prefilter';

/** Most source posts an idea prompt carries. */
export const MAX_SOURCE_POSTS = 6;
const CANDIDATE_LIMIT = 200;
const EXCERPT_CHARS = 200;
const HOUR_MS = 3_600_000;
// Untriaged posts rank as a middling triage score.
const UNTRIAGED_SCORE = 50;
const MAX_ENGAGEMENT_BONUS = 20;
const TOPIC_BONUS = 15;
// The builder's audience: crypto, the LONG ecosystem, Robinhood Chain, trading.
const TOPIC = /crypto|robinhood|\blong\b|\beco(system)?\b|\btrad(e|es|ing|er|ers)\b|\btokens?\b|on-?chain|\bchain\b|\bwallets?\b|\bdefi\b|\$[a-z]{2,10}\b/i;

/** A captured, non-own, non-reply post that an inspired or quote idea could come from. */
export interface SourceCandidate {
  statusId: string;
  authorHandle: string;
  text: string;
  postedAt: string | null;
  capturedAt: number;
  /** Triage score (0-100), null when not triaged. */
  score: number | null;
  likes: number;
  reposts: number;
  replies: number;
}

/** A source post as the prompt shows it. */
export interface SourcePost {
  statusId: string;
  author: string;
  excerpt: string;
}

export interface SourceRules {
  now: number;
  maxAgeHours: number;
  /** Posts never offered again: those already quoted. */
  exclude: ReadonlySet<string>;
  limit?: number;
}

export const excerptOf = (text: string): string => replaceDashes(text).replace(/\s+/g, ' ').trim().slice(0, EXCERPT_CHARS);

function engagementBonus(c: SourceCandidate): number {
  return Math.min(MAX_ENGAGEMENT_BONUS, 6 * Math.log10(1 + c.likes + 2 * c.reposts + c.replies));
}

/** Higher first: triage score, plus engagement, plus a bonus for the builder's topics. */
export function sourceRank(c: SourceCandidate): number {
  return (c.score ?? UNTRIAGED_SCORE) + engagementBonus(c) + (TOPIC.test(c.text) ? TOPIC_BONUS : 0);
}

// The triage age limit; captured time stands in when posted time is unknown.
function isFresh(c: SourceCandidate, now: number, maxAgeHours: number): boolean {
  const age = ageHours(c.postedAt, now) ?? (now - c.capturedAt) / HOUR_MS;
  return age <= maxAgeHours;
}

/** The best fresh, not yet quoted posts with text, best first, bounded. */
export function selectSourcePosts(candidates: readonly SourceCandidate[], rules: SourceRules): SourceCandidate[] {
  return candidates
    .filter((c) => !rules.exclude.has(c.statusId) && excerptOf(c.text) !== '' && isFresh(c, rules.now, rules.maxAgeHours))
    .sort((a, b) => sourceRank(b) - sourceRank(a))
    .slice(0, rules.limit ?? MAX_SOURCE_POSTS);
}

export const toPromptSource = (c: SourceCandidate): SourcePost => ({ statusId: c.statusId, author: c.authorHandle, excerpt: excerptOf(c.text) });

export function ideaSourceOf(c: SourceCandidate): IdeaSource {
  return {
    statusId: c.statusId,
    url: `https://x.com/${c.authorHandle}/status/${c.statusId}`,
    authorHandle: c.authorHandle,
    excerpt: excerptOf(c.text),
  };
}

interface CandidateRow {
  status_id: string;
  author_handle: string;
  text: string;
  posted_at: string | null;
  captured_at: number;
  score: number | null;
  likes: number;
  reposts: number;
  replies: number;
}

function loadSourceCandidates(db: DatabaseSync): SourceCandidate[] {
  const rows = db
    .prepare(
      `SELECT p.status_id, p.author_handle, p.text, p.posted_at, p.captured_at, t.score, p.likes, p.reposts, p.replies
       FROM posts p LEFT JOIN triage t ON t.status_id = p.status_id
       WHERE p.is_own = 0 AND p.is_reply = 0 ORDER BY p.seq DESC LIMIT ?`,
    )
    .all(CANDIDATE_LIMIT) as unknown as CandidateRow[];
  return rows.map((r) => ({
    statusId: r.status_id,
    authorHandle: r.author_handle,
    text: r.text,
    postedAt: r.posted_at,
    capturedAt: r.captured_at,
    score: r.score,
    likes: r.likes,
    reposts: r.reposts,
    replies: r.replies,
  }));
}

/** Status ids of every post a saved quote idea already comes from. */
export function quotedStatusIds(db: DatabaseSync): Set<string> {
  const rows = db
    .prepare(
      `SELECT json_extract(i.value, '$.source.statusId') AS id
       FROM digests d JOIN json_each(CASE WHEN json_valid(d.ideas) THEN d.ideas ELSE '[]' END) i
       WHERE json_extract(i.value, '$.kind') = 'quote'`,
    )
    .all() as unknown as { id: string | null }[];
  return new Set(rows.flatMap((r) => (r.id ? [r.id] : [])));
}

/** The source posts for the next idea prompt: fresh, not own, never already quoted. */
export function freshSourcePosts(db: DatabaseSync, maxAgeHours: number, now: number): SourceCandidate[] {
  return selectSourcePosts(loadSourceCandidates(db), { now, maxAgeHours, exclude: quotedStatusIds(db) });
}
