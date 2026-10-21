import { describe, expect, it } from 'vitest';
import { isPostTabUrl } from './x-tab';

describe('isPostTabUrl', () => {
  it('matches the post page and its sub-pages', () => {
    expect(isPostTabUrl('https://x.com/alice/status/1001', '1001')).toBe(true);
    expect(isPostTabUrl('https://x.com/Alice/status/1001?s=20', '1001')).toBe(true);
    expect(isPostTabUrl('https://x.com/alice/status/1001/photo/1', '1001')).toBe(true);
    expect(isPostTabUrl('https://x.com/alice/status/1001#top', '1001')).toBe(true);
  });

  it('rejects other posts, prefixes, hosts and missing urls', () => {
    expect(isPostTabUrl('https://x.com/alice/status/10011', '1001')).toBe(false);
    expect(isPostTabUrl('https://x.com/alice/status/2002', '1001')).toBe(false);
    expect(isPostTabUrl('https://evil.example/alice/status/1001', '1001')).toBe(false);
    expect(isPostTabUrl('https://x.com.evil.example/alice/status/1001', '1001')).toBe(false);
    expect(isPostTabUrl('https://x.com/home', '1001')).toBe(false);
    expect(isPostTabUrl(undefined, '1001')).toBe(false);
  });
});
