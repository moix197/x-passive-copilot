import { describe, expect, it } from 'vitest';
import { earliestReset, nextPacificMidnight, pickModel, quotaResetAt, retryAfterSec } from './quota';

const utc = (iso: string) => Date.parse(iso);

describe('nextPacificMidnight', () => {
  it.each([
    ['2026-10-19T17:24:09Z', '2026-10-20T07:00:00Z'], // PDT (UTC-7)
    ['2026-12-01T12:00:00Z', '2026-12-02T08:00:00Z'], // PST (UTC-8)
    ['2026-10-20T06:59:59Z', '2026-10-20T07:00:00Z'], // one second before Pacific midnight
    ['2026-10-20T07:00:00Z', '2026-10-21T07:00:00Z'], // exactly at midnight: the next one
    ['2026-10-31T20:00:00Z', '2026-11-01T07:00:00Z'], // the day DST ends: midnight is still PDT
    ['2026-11-01T12:00:00Z', '2026-11-02T08:00:00Z'], // after fall-back: PST
    ['2026-03-07T20:00:00Z', '2026-03-08T08:00:00Z'], // the day DST starts: midnight is still PST
    ['2026-03-08T12:00:00Z', '2026-03-09T07:00:00Z'], // after spring-forward: PDT
  ])('from %s resets at %s', (now, reset) => {
    expect(new Date(nextPacificMidnight(utc(now))).toISOString()).toBe(new Date(utc(reset)).toISOString());
  });
});

describe('retryAfterSec', () => {
  it('reads the provider retry hint in its usual spellings', () => {
    expect(retryAfterSec('Quota exceeded ... Please retry in 48.279s.')).toBe(49);
    expect(retryAfterSec('{"retryDelay": "30s"}')).toBe(30);
    expect(retryAfterSec('retry after 5 seconds')).toBe(5);
    expect(retryAfterSec('You exceeded your current quota')).toBeNull();
  });
});

describe('quotaResetAt', () => {
  const now = utc('2026-10-19T17:24:09Z');
  const midnight = utc('2026-10-20T07:00:00Z');

  it('honours a per-minute retry hint', () => {
    expect(quotaResetAt('Resource exhausted. Please retry in 20s.', now, false)).toEqual({ until: now + 20_000, daily: false });
  });

  it('treats a daily quota, a quota without hint, or a repeat right after a short cooldown as spent until Pacific midnight', () => {
    const perDay = 'quota GenerateRequestsPerDayPerProjectPerModel-FreeTier. Please retry in 20s.';
    expect(quotaResetAt(perDay, now, false)).toEqual({ until: midnight, daily: true });
    expect(quotaResetAt('You exceeded your current quota, please check your plan', now, false)).toEqual({ until: midnight, daily: true });
    expect(quotaResetAt('Please retry in 20s.', now, true)).toEqual({ until: midnight, daily: true });
  });

  it('cools a bare rate limit down for a minute', () => {
    expect(quotaResetAt('429 Too Many Requests', now, false)).toEqual({ until: now + 60_000, daily: false });
  });
});

describe('pickModel / earliestReset', () => {
  const models = ['a', 'b', 'c'];
  const until = (map: Record<string, number>) => (m: string) => map[m] ?? 0;

  it('picks the first model with quota left, in configured order', () => {
    expect(pickModel(models, until({}), 100)).toBe('a');
    expect(pickModel(models, until({ a: 200 }), 100)).toBe('b');
    expect(pickModel(models, until({ a: 200, b: 50 }), 100)).toBe('b');
    expect(pickModel(models, until({ a: 200, b: 300, c: 150 }), 100)).toBeNull();
  });

  it('reports the earliest reset only when every model is exhausted', () => {
    expect(earliestReset(models, until({ a: 200 }), 100)).toBe(0);
    expect(earliestReset(models, until({ a: 200, b: 300, c: 150 }), 100)).toBe(150);
    expect(earliestReset([], until({}), 100)).toBe(0);
  });
});
