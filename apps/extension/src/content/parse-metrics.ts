import type { CapturedPost } from '@xc/shared/types';

type Metrics = CapturedPost['metrics'];

const MULTIPLIER: Record<string, number> = { K: 1_000, M: 1_000_000 };

function toCount(digits: string, suffix: string | undefined): number {
  const value = parseFloat(digits.replace(/,/g, ''));
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * (MULTIPLIER[suffix?.toUpperCase() ?? ''] ?? 1));
}

function countBefore(label: string, word: string): number {
  const match = new RegExp(String.raw`([\d.,]+)\s*([KM])?\s+${word}`, 'i').exec(label);
  return match?.[1] ? toCount(match[1], match[2]) : 0;
}

export function parseMetrics(label: string): Metrics {
  return {
    replies: countBefore(label, 'repl'),
    reposts: countBefore(label, 'repost'),
    likes: countBefore(label, 'like'),
    views: countBefore(label, 'view'),
  };
}
