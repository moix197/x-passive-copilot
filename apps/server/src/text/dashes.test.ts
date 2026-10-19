import { describe, expect, it } from 'vitest';
import { replaceDashes } from './dashes';

describe('replaceDashes', () => {
  it('turns spaced and bare em dashes into commas', () => {
    expect(replaceDashes('Nice work — what did you cut?')).toBe('Nice work, what did you cut?');
    expect(replaceDashes('Nice work—what did you cut?')).toBe('Nice work, what did you cut?');
  });

  it('treats a spaced en dash as a dash and a bare one as a hyphen', () => {
    expect(replaceDashes('Fast – and simple')).toBe('Fast, and simple');
    expect(replaceDashes('pre–launch')).toBe('pre-launch');
  });

  it('keeps number ranges as hyphens', () => {
    expect(replaceDashes('2020–2021 and 5 – 10')).toBe('2020-2021 and 5-10');
    expect(replaceDashes('5—10 posts')).toBe('5-10 posts');
  });

  it('avoids doubled punctuation and dangling edge commas', () => {
    expect(replaceDashes('Wait. — Really?')).toBe('Wait. Really?');
    expect(replaceDashes('— hello')).toBe('hello');
    expect(replaceDashes('hello —')).toBe('hello');
  });

  it('collapses runs of dashes and leaves clean text alone', () => {
    expect(replaceDashes('a —— b')).toBe('a, b');
    expect(replaceDashes('plain - hyphen text')).toBe('plain - hyphen text');
  });

  it('never swallows line breaks around a dash', () => {
    expect(replaceDashes('a —\n\nb')).toBe('a\n\nb');
    expect(replaceDashes('line one\n— line two')).toBe('line one\nline two');
    expect(replaceDashes('one — two\nthree')).toBe('one, two\nthree');
    expect(replaceDashes('Wait. —\r\nok')).toBe('Wait.\r\nok');
  });
});
