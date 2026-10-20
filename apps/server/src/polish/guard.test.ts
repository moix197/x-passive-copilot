import { describe, expect, it } from 'vitest';
import { checkReply, productMention, replyLength, wordyReply } from './guard';

const rules = (text: string, source = 'a post about tools') => checkReply(text, source).map((v) => v.rule);

describe('length', () => {
  it('allows exactly 280 chars and rejects 281', () => {
    expect(rules('a'.repeat(280))).toEqual([]);
    expect(rules('a'.repeat(281))).toEqual(['too-long']);
  });

  it('counts a URL as 23 chars', () => {
    const url = 'https://example.com/a/very/long/path/that/is/over/twenty/three/chars';
    const source = `see ${url}`;
    expect(replyLength(url)).toBe(23);
    expect(checkReply(`${'a'.repeat(257)}${url}`, source)).toEqual([]);
    expect(checkReply(`${'a'.repeat(258)}${url}`, source).map((v) => v.rule)).toEqual(['too-long']);
  });
});

describe('hashtags', () => {
  it('allows 0 and 1, rejects 2', () => {
    expect(rules('nice build')).toEqual([]);
    expect(rules('nice build #solana')).toEqual([]);
    expect(rules('nice build #solana #defi')).toEqual(['hashtags']);
  });
});

describe('hype words', () => {
  it.each(['This is a GEM.', 'to the moon!', 'buy now', 'real alpha here', 'easy 100x'])('rejects %s', (text) => {
    expect(rules(text)).toContain('hype-word');
  });

  it('does not match inside other words', () => {
    expect(rules('the gemstone market and a buyer guide')).toEqual([]);
  });
});

describe('price predictions and advice', () => {
  it('rejects price predictions', () => {
    expect(rules('this will hit $500 soon')).toContain('price-prediction');
    expect(rules('my price target is high')).toContain('price-prediction');
  });

  it('rejects advice phrasing', () => {
    expect(rules('you should ship it today')).toContain('advice');
    expect(rules('nfa but dyor')).toContain('advice');
  });

  it('allows plain builder talk', () => {
    expect(rules('we shipped the indexer last week, caching was the hard part')).toEqual([]);
  });
});

describe('foreign URLs and mentions', () => {
  it('rejects URLs and mentions missing from the source', () => {
    expect(rules('see https://evil.example/x', 'no links')).toEqual(['foreign-url']);
    expect(rules('ping @someone', 'no mentions')).toEqual(['foreign-mention']);
  });

  it('detects bare domains as URLs, but not code names or emails', () => {
    expect(rules('try foo.app today', 'no links')).toEqual(['foreign-url']);
    expect(rules('see x.co/abc.', 'no links')).toEqual(['foreign-url']);
    expect(rules('built on Node.js, mail me@site.io', 'no links @me')).toEqual([]);
    expect(replyLength('foo.app')).toBe(23);
  });

  it('does not treat script filenames as bare domains', () => {
    expect(rules('run install.sh', 'no links')).toEqual([]);
    expect(rules('see setup.sh', 'no links')).toEqual([]);
    expect(rules('build main.cc and lib.so', 'no links')).toEqual([]);
    expect(rules('try example.com', 'no links')).toEqual(['foreign-url']);
  });

  it('matches source URLs ignoring scheme and trailing punctuation', () => {
    expect(rules('see https://x.co/abc!', 'link: x.co/abc')).toEqual([]);
    expect(rules('see (https://site.io/a).', 'read https://site.io/a')).toEqual([]);
  });

  it('allows the ones in the source, case-insensitively', () => {
    const source = 'read https://site.example/a.  cc @Builder';
    expect(rules('good read https://site.example/a, thanks @builder', source)).toEqual([]);
  });
});

describe('productMention', () => {
  it('flags the product name only when the post does not mention it', () => {
    expect(productMention('We built Spacehub to track exactly this', 'burns are up', 'Spacehub')).toEqual([
      { rule: 'product-mention', detail: 'Spacehub' },
    ]);
    expect(productMention('spacehub.', 'burns are up', 'Spacehub')).toHaveLength(1);
    expect(productMention('Spacehub does that', 'anyone tried Spacehub?', 'Spacehub')).toEqual([]);
    expect(productMention('a spacehubby word', 'x', 'Spacehub')).toEqual([]);
    expect(productMention('Acme (beta) rocks', 'x', 'Acme (beta)')).toHaveLength(1);
  });
});

describe('othering', () => {
  it('flags labels that put down a group of people', () => {
    expect(rules('chart watching is for tourists anyway')).toEqual(['othering']);
    expect(rules('even the paper hands and normies')).toEqual(['othering', 'othering']);
    expect(rules('Paper-handed jeets')).toEqual(['othering', 'othering']);
    expect(rules('tourism on chain is growing')).toEqual([]);
  });
});

describe('wordyReply', () => {
  it('flags replies over the 200 char target up to the hard limit, which too-long already covers', () => {
    expect(wordyReply('a'.repeat(200))).toEqual([]);
    expect(wordyReply('a'.repeat(201))).toEqual([{ rule: 'wordy', detail: '201 chars' }]);
    expect(wordyReply('a'.repeat(281))).toEqual([]);
  });
});
