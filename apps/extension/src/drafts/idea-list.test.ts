import { describe, expect, it } from 'vitest';
import type { DigestIdea, DigestView } from '@xc/shared/types';
import { MAX_LISTED_IDEAS, mergeIdeas, viewIdeas } from './idea-list';

const idea = (id: string, text = `idea ${id}`): DigestIdea => ({ id, text, feature: 'f', kind: 'spacehub', source: null, sourceIds: [], polish: null });

describe('viewIdeas', () => {
  it('lists the latest digest ideas, then the earlier ones', () => {
    const view = {
      digest: { createdAt: 3, trends: [], ideas: [idea('3-0'), idea('3-1')] },
      earlier: [{ createdAt: 2, ideas: [idea('2-0')] }, { createdAt: 1, ideas: [idea('1-0')] }],
    } as unknown as DigestView;
    expect(viewIdeas(view).map((i) => i.id)).toEqual(['3-0', '3-1', '2-0', '1-0']);
    expect(viewIdeas({ digest: null, earlier: [] } as unknown as DigestView)).toEqual([]);
  });
});

describe('mergeIdeas', () => {
  it('orders newest row first, keeps the order inside a row and lists each idea once', () => {
    const merged = mergeIdeas([idea('12-0', 'old copy'), idea('3-0')], [idea('12-0', 'new copy'), idea('10-1'), idea('10-0')]);
    expect(merged.map((i) => i.id)).toEqual(['12-0', '10-0', '10-1', '3-0']);
    expect(merged[0]?.text).toBe('new copy');
  });

  it('keeps at most MAX_LISTED_IDEAS, dropping the oldest', () => {
    const many = Array.from({ length: MAX_LISTED_IDEAS + 5 }, (_, n) => idea(`${n + 1}-0`));
    const merged = mergeIdeas([], many);
    expect(merged).toHaveLength(MAX_LISTED_IDEAS);
    expect(merged[0]?.id).toBe(`${MAX_LISTED_IDEAS + 5}-0`);
  });
});
