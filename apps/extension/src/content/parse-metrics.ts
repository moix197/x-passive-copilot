import type { CapturedPost } from '@xc/shared/types';

type Metrics = CapturedPost['metrics'];

const MULTIPLIER: Record<string, number> = {
  k: 1_000,
  mil: 1_000,
  m: 1_000_000,
  mill: 1_000_000,
  'mill.': 1_000_000,
};
const GROUPED = /^\d{1,3}([.,]\d{3})+$/;

const WORDS = {
  replies: 'replies|reply|respuestas?',
  reposts: 'reposts?',
  likes: 'likes?|me gusta',
  views: 'views?|reproducci(?:ón|on|ones)',
} as const;

function toCount(digits: string, suffix: string | undefined): number {
  const plain = GROUPED.test(digits) ? digits.replace(/[.,]/g, '') : digits.replace(',', '.');
  const value = parseFloat(plain);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * (MULTIPLIER[suffix?.toLowerCase() ?? ''] ?? 1));
}

function countBefore(label: string, words: string): number {
  const pattern = String.raw`(\d[\d.,]*)\s*(mill\.?|mil|K|M)?\s+(?:${words})(?![\p{L}])`;
  const match = new RegExp(pattern, 'iu').exec(label);
  return match?.[1] ? toCount(match[1], match[2]) : 0;
}

export function parseMetrics(label: string): Metrics {
  return {
    replies: countBefore(label, WORDS.replies),
    reposts: countBefore(label, WORDS.reposts),
    likes: countBefore(label, WORDS.likes),
    views: countBefore(label, WORDS.views),
  };
}
