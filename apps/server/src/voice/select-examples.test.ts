import { describe, expect, it } from 'vitest';
import { selectExamples, type OwnPost } from './select-examples';

const own = (text: string, likes = 0, reposts = 0, replies = 0): OwnPost => ({ text, likes, reposts, replies });
const text = (n: number) => `own post number ${n} with enough length`;

describe('selectExamples', () => {
  it('orders own posts by engagement, ties keep input order', () => {
    const ownPosts = [own(text(1), 1), own(text(2), 5), own(text(3), 1, 1), own(text(4), 5)];
    const { positive } = selectExamples({ ownPosts, positives: [], negatives: [] });
    expect(positive).toEqual([text(2), text(4), text(3), text(1)]);
  });

  it('caps positives at 8', () => {
    const ownPosts = Array.from({ length: 12 }, (_, i) => own(text(i), 100 - i));
    expect(selectExamples({ ownPosts, positives: [], negatives: [] }).positive).toHaveLength(8);
  });

  it('keeps only own posts of 20-280 characters', () => {
    const ownPosts = [own('too short', 99), own('x'.repeat(281), 99), own('x'.repeat(20)), own('y'.repeat(280))];
    const { positive } = selectExamples({ ownPosts, positives: [], negatives: [] });
    expect(positive).toEqual(['x'.repeat(20), 'y'.repeat(280)]);
  });

  it('dedupes ignoring case and whitespace', () => {
    const ownPosts = [own('Same   text here, long enough', 5), own('same text here, long enough', 4)];
    const { positive } = selectExamples({ ownPosts, positives: ['SAME text here,  long enough'], negatives: [] });
    expect(positive).toHaveLength(1);
  });

  it('puts feedback positives first and drops texts that were rated negative', () => {
    const ownPosts = [own(text(1), 9), own(text(2), 8)];
    const result = selectExamples({ ownPosts, positives: ['liked reply text'], negatives: [text(2)] });
    expect(result.positive).toEqual(['liked reply text', text(1)]);
    expect(result.negative).toEqual([text(2)]);
  });

  it('keeps at most 3 negatives, newest first', () => {
    const negatives = ['n1 one', 'n2 two', 'n3 three', 'n4 four'];
    expect(selectExamples({ ownPosts: [], positives: [], negatives }).negative).toEqual(negatives.slice(0, 3));
  });
});
