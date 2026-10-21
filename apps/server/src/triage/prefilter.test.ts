import { describe, expect, it } from 'vitest';
import { isWithinAgeLimit, prefilter, type PrefilterRules } from './prefilter';

const NOW = Date.parse('2026-10-17T12:00:00Z');
const rules: PrefilterRules = { handle: 'MyHandle', watchlist: ['@Vip_User'], maxAgeHours: 24, mentionMaxAgeHours: 72, minEngagement: 3, minFlagScore: 80 };
const metrics = (likes: number, reposts = 0, replies = 0) => ({ likes, reposts, replies, views: 0 });
const post = (over: Partial<Parameters<typeof prefilter>[0]> = {}) => ({
  authorHandle: 'someone',
  text: 'hello world',
  postedAt: '2026-10-17T11:00:00Z',
  metrics: metrics(10),
  replyTo: [] as string[],
  ...over,
});

describe('prefilter', () => {
  it('never triages own posts, case-insensitively, even when they mention the handle', () => {
    const own = post({ authorHandle: 'MYHANDLE', text: 'note to @MyHandle' });
    expect(prefilter(own, rules, NOW)).toEqual({ action: 'skip', reason: 'own post' });
  });

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

  it('mention is case-insensitive, whole-handle only, and overrides engagement skips', () => {
    const stale = { postedAt: '2020-01-01T00:00:00Z', metrics: metrics(0) };
    expect(prefilter(post({ ...stale, postedAt: '2026-10-16T12:00:00Z', text: 'hey @myhandle thoughts?' }), rules, NOW)).toEqual({
      action: 'triage',
      mustFlag: 'mention',
    });
    expect(prefilter(post({ ...stale, postedAt: '2026-10-16T12:00:00Z', text: '@MYHANDLE' }), rules, NOW)).toMatchObject({ mustFlag: 'mention' });
    expect(prefilter(post({ ...stale, text: 'hey @myhandle2' }), rules, NOW).action).toBe('skip');
    expect(prefilter(post({ ...stale, text: 'mail me@myhandle' }), rules, NOW).action).toBe('skip');
  });

  it('a reply to the handle is a mention even without @handle in the text', () => {
    const stale = { postedAt: '2020-01-01T00:00:00Z', metrics: metrics(0), text: 'agreed, ship it' };
    expect(prefilter(post({ ...stale, postedAt: '2026-10-16T12:00:00Z', replyTo: ['other', 'MYHANDLE'] }), rules, NOW)).toEqual({
      action: 'triage',
      mustFlag: 'mention',
    });
    expect(prefilter(post({ ...stale, replyTo: ['myhandle2'] }), rules, NOW).action).toBe('skip');
  });

  it('watchlist author is always flagged, case-insensitive, @ optional in config', () => {
    const result = prefilter(post({ authorHandle: 'VIP_user', metrics: metrics(0) }), rules, NOW);
    expect(result).toEqual({ action: 'triage', mustFlag: 'watchlist' });
  });

  it('watchlist posts obey maxAgeHours: 23h flagged, 25h skipped', () => {
    const at = (hours: number) => new Date(NOW - hours * 3600_000).toISOString();
    const watched = { authorHandle: 'vip_user', metrics: metrics(0) };
    expect(prefilter(post({ ...watched, postedAt: at(23) }), rules, NOW)).toEqual({ action: 'triage', mustFlag: 'watchlist' });
    expect(prefilter(post({ ...watched, postedAt: at(25) }), rules, NOW)).toEqual({ action: 'skip', reason: 'older than 24h' });
  });

  it('mentions obey mentionMaxAgeHours: 71h flagged, 73h skipped', () => {
    const at = (hours: number) => new Date(NOW - hours * 3600_000).toISOString();
    const mention = { text: '@myhandle hi', metrics: metrics(0) };
    expect(prefilter(post({ ...mention, postedAt: at(71) }), rules, NOW)).toEqual({ action: 'triage', mustFlag: 'mention' });
    expect(prefilter(post({ ...mention, postedAt: at(73) }), rules, NOW)).toEqual({ action: 'skip', reason: 'older than 72h' });
  });

  it('must-flag posts with unknown date are still flagged', () => {
    expect(prefilter(post({ authorHandle: 'vip_user', postedAt: null }), rules, NOW)).toMatchObject({ mustFlag: 'watchlist' });
  });

  it('mention wins over watchlist', () => {
    const result = prefilter(post({ authorHandle: 'vip_user', text: '@myhandle hi' }), rules, NOW);
    expect(result).toEqual({ action: 'triage', mustFlag: 'mention' });
  });
});

describe('isWithinAgeLimit', () => {
  it('never ages out a post flagged by hand', () => {
    const now = Date.parse('2026-10-20T00:00:00Z');
    const old = new Date(now - 30 * 24 * 3_600_000).toISOString();
    expect(isWithinAgeLimit(old, 'manual', rules, now)).toBe(true);
    expect(isWithinAgeLimit(old, 'mention', rules, now)).toBe(false);
    expect(isWithinAgeLimit(old, undefined, rules, now)).toBe(false);
  });
});
