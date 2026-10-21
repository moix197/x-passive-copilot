import { describe, expect, it } from 'vitest';
import type { IdeaKind } from '@xc/shared';
import { capIdeaKinds, pickNextKind, planDigestKinds } from './idea-kind';

// Runs the rotation n times, feeding each pick back as the newest kind.
function rotate(n: number, hasSources: boolean, start: IdeaKind[] = []): IdeaKind[] {
  const newestFirst = [...start];
  const picks: IdeaKind[] = [];
  for (let i = 0; i < n; i += 1) {
    const kind = pickNextKind(newestFirst, hasSources);
    picks.push(kind);
    newestFirst.unshift(kind);
  }
  return picks;
}

const spacehubInEveryWindow = (kinds: IdeaKind[], size: number) =>
  kinds.slice(0, kinds.length - size + 1).map((_, i) => kinds.slice(i, i + size).filter((k) => k === 'spacehub').length);

describe('pickNextKind', () => {
  it('never repeats the last kind and picks the least recently used one', () => {
    expect(pickNextKind([], true)).toBe('spacehub');
    expect(pickNextKind(['spacehub'], true)).toBe('eco');
    expect(pickNextKind(['quote', 'eco', 'inspired', 'spacehub'], true)).toBe('spacehub');
    expect(pickNextKind(['eco', 'quote', 'spacehub', 'inspired'], true)).toBe('inspired');
  });

  it('keeps spacehub to at most 1 in any 3, over a long run', () => {
    const kinds = rotate(40, true);
    for (let i = 1; i < kinds.length; i += 1) expect(kinds[i]).not.toBe(kinds[i - 1]);
    expect(Math.max(...spacehubInEveryWindow(kinds, 3))).toBe(1);
    expect(new Set(kinds)).toEqual(new Set(['spacehub', 'eco', 'inspired', 'quote']));
  });

  it('skips inspired and quote without source posts, falling back to eco rather than spacehub', () => {
    const kinds = rotate(12, false);
    expect(kinds.every((k) => k === 'spacehub' || k === 'eco')).toBe(true);
    expect(Math.max(...spacehubInEveryWindow(kinds, 3))).toBe(1);
    expect(pickNextKind(['eco', 'spacehub'], false)).toBe('eco');
  });

  it('starts after explicit picks: a spacehub asked for just now is not followed by another', () => {
    expect(pickNextKind(['spacehub'], false)).toBe('eco');
    expect(pickNextKind(['quote', 'spacehub'], true)).not.toBe('spacehub');
  });
});

describe('planDigestKinds', () => {
  it('plans 3 kinds with at most one spacehub, continuing the rotation', () => {
    expect(planDigestKinds([], true)).toEqual(['spacehub', 'eco', 'inspired']);
    expect(planDigestKinds(['inspired', 'eco', 'spacehub'], true)).toEqual(['quote', 'spacehub', 'eco']);
    expect(planDigestKinds(['spacehub'], true)).toEqual(['eco', 'inspired', 'quote']);
    expect(planDigestKinds([], false)).toEqual(['spacehub', 'eco', 'eco']);
  });
});

describe('capIdeaKinds', () => {
  const idea = (kind: IdeaKind, statusId?: string) => ({ kind, source: statusId ? { statusId } : null });

  it('keeps the first spacehub idea and the first quote of each post', () => {
    const ideas = [idea('spacehub'), idea('quote', '1'), idea('spacehub'), idea('quote', '1'), idea('quote', '2'), idea('eco')];
    expect(capIdeaKinds(ideas)).toEqual([idea('spacehub'), idea('quote', '1'), idea('quote', '2'), idea('eco')]);
  });
});
