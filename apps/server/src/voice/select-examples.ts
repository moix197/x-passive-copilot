import type { VoiceProfile } from '@xc/shared';

export const MAX_POSITIVE = 8;
export const MAX_NEGATIVE = 3;
const MIN_LENGTH = 20;
const MAX_LENGTH = 280;

export interface OwnPost {
  text: string;
  likes: number;
  reposts: number;
  replies: number;
}

export interface ExampleInput {
  ownPosts: OwnPost[];
  /** Feedback examples, newest first. */
  positives: string[];
  /** Feedback examples, newest first. */
  negatives: string[];
}

export interface Examples {
  positive: string[];
  negative: string[];
}

export interface Style extends Examples {
  voice: VoiceProfile | null;
}

const engagement = (p: OwnPost): number => p.likes + p.reposts + p.replies;
const normalize = (text: string): string => text.trim().replace(/\s+/g, ' ').toLowerCase();

function inRange(text: string): boolean {
  const length = [...text.trim()].length;
  return length >= MIN_LENGTH && length <= MAX_LENGTH;
}

function mostEngaged(posts: OwnPost[]): string[] {
  return posts
    .map((post, index) => ({ post, index }))
    .filter(({ post }) => inRange(post.text))
    .sort((a, b) => engagement(b.post) - engagement(a.post) || a.index - b.index)
    .map(({ post }) => post.text.trim());
}

function dedupe(texts: string[], limit: number): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const text of texts) {
    const key = normalize(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    kept.push(text.trim());
    if (kept.length === limit) break;
  }
  return kept;
}

export function selectExamples({ ownPosts, positives, negatives }: ExampleInput): Examples {
  const negative = dedupe(negatives, MAX_NEGATIVE);
  const avoid = new Set(negative.map(normalize));
  const candidates = [...positives, ...mostEngaged(ownPosts)].filter((t) => !avoid.has(normalize(t)));
  return { positive: dedupe(candidates, MAX_POSITIVE), negative };
}
