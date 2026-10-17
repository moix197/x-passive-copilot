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

  it('parses the Spanish label', () => {
    const label = '5 respuestas, 3 reposts, 56 Me gusta, 23 elementos guardados, 1449 reproducciones';
    expect(parseMetrics(label)).toEqual({ replies: 5, reposts: 3, likes: 56, views: 1449 });
  });

  it('handles omitted parts and singular Spanish nouns in any order', () => {
    expect(parseMetrics('1 reproducción, 1 respuesta')).toEqual({ replies: 1, reposts: 0, likes: 0, views: 1 });
    expect(parseMetrics('12 Me gusta')).toEqual({ replies: 0, reposts: 0, likes: 12, views: 0 });
  });

  it('parses live labels with omitted zero parts', () => {
    expect(parseMetrics('38 respuestas, 15 Me gusta, 1484 reproducciones')).toEqual({ replies: 38, reposts: 0, likes: 15, views: 1484 });
    expect(parseMetrics('3 Me gusta, 289 reproducciones')).toEqual({ replies: 0, reposts: 0, likes: 3, views: 289 });
    expect(parseMetrics('1 repost').reposts).toBe(1);
  });

  it('handles dot thousands and Spanish mil/M suffixes', () => {
    expect(parseMetrics('1.234 Me gusta, 12.000 reproducciones')).toMatchObject({ likes: 1234, views: 12000 });
    expect(parseMetrics('2 mil reproducciones').views).toBe(2000);
    expect(parseMetrics('1,5 M reproducciones').views).toBe(1_500_000);
    expect(parseMetrics('3 mill. reproducciones').views).toBe(3_000_000);
  });

  it('returns zeros for garbage or empty labels', () => {
    const zeros = { replies: 0, reposts: 0, likes: 0, views: 0 };
    expect(parseMetrics('')).toEqual(zeros);
    expect(parseMetrics('lorem ipsum ... K views')).toEqual(zeros);
  });
});
