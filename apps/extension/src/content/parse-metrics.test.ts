import { describe, expect, it } from 'vitest';
import { parseMetrics } from './parse-metrics';

describe('parseMetrics', () => {
  it('parses a full label', () => {
    expect(parseMetrics('5 replies, 10 reposts, 120 likes, 1.2K views')).toEqual({
      replies: 5,
      reposts: 10,
      likes: 120,
      views: 1200,
    });
  });

  it('handles K and M suffixes', () => {
    expect(parseMetrics('1M views').views).toBe(1_000_000);
    expect(parseMetrics('2.5K likes').likes).toBe(2500);
    expect(parseMetrics('3k reposts').reposts).toBe(3000);
  });

  it('handles thousands commas', () => {
    expect(parseMetrics('1,234 likes, 12,000 views')).toMatchObject({ likes: 1234, views: 12000 });
  });

  it('handles singular nouns', () => {
    expect(parseMetrics('1 reply, 1 repost, 1 like, 1 view')).toEqual({
      replies: 1,
      reposts: 1,
      likes: 1,
      views: 1,
    });
  });

  it('defaults missing parts to 0', () => {
    expect(parseMetrics('7 likes')).toEqual({ replies: 0, reposts: 0, likes: 7, views: 0 });
  });

  it('returns zeros for garbage or empty labels', () => {
    const zeros = { replies: 0, reposts: 0, likes: 0, views: 0 };
    expect(parseMetrics('')).toEqual(zeros);
    expect(parseMetrics('lorem ipsum ... K views')).toEqual(zeros);
  });
});
