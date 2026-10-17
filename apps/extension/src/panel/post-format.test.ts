import { describe, expect, it } from 'vitest';
import { formatAbsoluteTime, formatRelativeTime, initialsFor } from './post-format';

const NOW = new Date(2026, 9, 17, 15, 0, 0).getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('formatRelativeTime', () => {
  it.each([
    [2_000, 'now'],
    [45_000, '45s'],
    [12 * 60_000, '12m'],
    [3 * 3_600_000, '3h'],
    [23 * 3_600_000 + 59 * 60_000, '23h'],
  ])('formats %i ms ago as %s', (ms, expected) => {
    expect(formatRelativeTime(ago(ms), NOW)).toBe(expected);
  });

  it('shows month and day after a day, and the year only for older years', () => {
    expect(formatRelativeTime(new Date(2026, 9, 12, 9).toISOString(), NOW)).toBe('Oct 12');
    expect(formatRelativeTime(new Date(2025, 0, 3, 9).toISOString(), NOW)).toBe('Jan 3, 2025');
  });

  it('treats a slightly future timestamp (clock skew) as now', () => {
    expect(formatRelativeTime(new Date(NOW + 3_000).toISOString(), NOW)).toBe('now');
  });

  it('returns empty for missing or invalid dates', () => {
    expect(formatRelativeTime(null, NOW)).toBe('');
    expect(formatRelativeTime('not a date', NOW)).toBe('');
  });
});

describe('formatAbsoluteTime', () => {
  it('formats time then date', () => {
    expect(formatAbsoluteTime(new Date(2026, 9, 17, 15, 4).toISOString())).toBe('3:04 PM · Oct 17, 2026');
  });

  it('returns empty for missing dates', () => {
    expect(formatAbsoluteTime(null)).toBe('');
  });
});

describe('initialsFor', () => {
  it.each([
    ['Alice Smith', 'alice', 'AS'],
    ['bob', 'bob', 'B'],
    ['Ana María López', 'ana', 'AM'],
    ['🚀🚀', 'rocket_man', 'R'],
    ['', '', '?'],
    ['  ', '_x', '_'],
  ])('%s / @%s -> %s', (name, handle, expected) => {
    expect(initialsFor(name, handle)).toBe(expected);
  });
});
