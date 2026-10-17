import { describe, expect, it } from 'vitest';
import { prefilter, type PrefilterRules } from './prefilter';

const NOW = Date.parse('2026-10-17T12:00:00Z');
const rules: PrefilterRules = { handle: 'MyHandle', watchlist: ['@Vip_User'], maxAgeHours: 24, minEngagement: 3 };
const metrics = (likes: number, reposts = 0, replies = 0) => ({ likes, reposts, replies, views: 0 });
const post = (over: Partial<Parameters<typeof prefilter>[0]> = {}) => ({
  authorHandle: 'someone',
  text: 'hello world',
  postedAt: '2026-10-17T11:00:00Z',
  metrics: metrics(10),
  ...over,
});

describe('prefilter', () => {
  it('triages a fresh engaged post', () => {
    expect(prefilter(post(), rules, NOW)).toEqual({ action: 'triage' });
  });

  it('age boundary: exactly 24h passes, beyond is skipped', () => {
    const at = (hours: number) => new Date(NOW - hours * 3600_000).toISOString();
    expect(prefilter(post({ postedAt: at(24) }), rules, NOW).action).toBe('triage');
    const old = prefilter(post({ postedAt: at(24.01) }), rules, NOW);
    expect(old).toEqual({ action: 'skip', reason: 'older than 24h' });
  });

  it('unknown or invalid time is not skipped for age', () => {
    expect(prefilter(post({ postedAt: null }), rules, NOW).action).toBe('triage');
    expect(prefilter(post({ postedAt: 'garbage' }), rules, NOW).action).toBe('triage');
  });

  it('engagement floor sums likes, reposts, replies', () => {
    expect(prefilter(post({ metrics: metrics(1, 1, 0) }), rules, NOW).action).toBe('skip');
    expect(prefilter(post({ metrics: metrics(1, 1, 1) }), rules, NOW).action).toBe('triage');
  });

  it('missing metrics (all zero) are skipped', () => {
    expect(prefilter(post({ metrics: metrics(0) }), rules, NOW)).toEqual({
      action: 'skip',
      reason: 'engagement below 3',
    });
  });

  it('mention is case-insensitive, whole-handle only, and overrides skips', () => {
    const stale = { postedAt: '2020-01-01T00:00:00Z', metrics: metrics(0) };
    expect(prefilter(post({ ...stale, text: 'hey @myhandle thoughts?' }), rules, NOW)).toEqual({
      action: 'triage',
      mustFlag: 'mention',
    });
    expect(prefilter(post({ ...stale, text: '@MYHANDLE' }), rules, NOW)).toMatchObject({ mustFlag: 'mention' });
    expect(prefilter(post({ ...stale, text: 'hey @myhandle2' }), rules, NOW).action).toBe('skip');
    expect(prefilter(post({ ...stale, text: 'mail me@myhandle' }), rules, NOW).action).toBe('skip');
  });

  it('watchlist author is always flagged, case-insensitive, @ optional in config', () => {
    const result = prefilter(post({ authorHandle: 'VIP_user', metrics: metrics(0) }), rules, NOW);
    expect(result).toEqual({ action: 'triage', mustFlag: 'watchlist' });
  });

  it('mention wins over watchlist', () => {
    const result = prefilter(post({ authorHandle: 'vip_user', text: '@myhandle hi' }), rules, NOW);
    expect(result).toEqual({ action: 'triage', mustFlag: 'mention' });
  });
});
