// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseArticle } from './parse-article';

function articleFrom(inner: string): Element {
  document.body.innerHTML = `<article data-testid="tweet">${inner}</article>`;
  return document.querySelector('article') as Element;
}

const AUTHOR = `
  <div data-testid="User-Name"><a href="/alice"><span>Alice</span></a><a href="/alice">@alice</a></div>
  <a href="/alice/status/1001"><time datetime="2026-10-17T10:00:00.000Z">1h</time></a>`;
const TEXT = '<div data-testid="tweetText"><span>hello world</span></div>';
const METRICS = '<div role="group" aria-label="5 replies, 10 reposts, 120 likes, 1.2K views"></div>';

describe('parseArticle', () => {
  it('parses a plain post', () => {
    expect(parseArticle(articleFrom(AUTHOR + TEXT + METRICS))).toEqual({
      statusId: '1001',
      authorName: 'Alice',
      authorHandle: 'alice',
      text: 'hello world',
      postedAt: '2026-10-17T10:00:00.000Z',
      metrics: { replies: 5, reposts: 10, likes: 120, views: 1200 },
      isReply: false,
      quotedStatusId: null,
    });
  });

  it('uses the outer author and text for a quote post', () => {
    const quote = `<div data-testid="quoteTweet">
      <div data-testid="User-Name"><a href="/carol"><span>Carol</span></a></div>
      <a href="/carol/status/2002"><time datetime="2026-10-16T09:00:00.000Z">x</time></a>
      <div data-testid="tweetText"><span>inner</span></div></div>`;
    const post = parseArticle(articleFrom(AUTHOR + TEXT + quote + METRICS));
    expect(post).toMatchObject({
      statusId: '1001',
      authorHandle: 'alice',
      authorName: 'Alice',
      text: 'hello world',
      quotedStatusId: '2002',
    });
  });

  it('does not leak quoted text when the outer post has no text', () => {
    const quote = `<div data-testid="quoteTweet"><a href="/carol/status/2002"><time>x</time></a>
      <div data-testid="tweetText"><span>inner</span></div></div>`;
    expect(parseArticle(articleFrom(AUTHOR + quote + METRICS))?.text).toBe('');
  });

  it('tags replies', () => {
    const reply = '<div data-testid="replyContext">Replying to @bob</div>';
    expect(parseArticle(articleFrom(reply + AUTHOR + TEXT + METRICS))?.isReply).toBe(true);
  });

  it('skips promoted posts', () => {
    const ad = '<div data-testid="placementTracking"></div>';
    expect(parseArticle(articleFrom(ad + AUTHOR + TEXT + METRICS))).toBeNull();
  });

  it('defaults metrics to zero when the group is missing', () => {
    expect(parseArticle(articleFrom(AUTHOR + TEXT))?.metrics).toEqual({
      replies: 0,
      reposts: 0,
      likes: 0,
      views: 0,
    });
  });

  it('keeps an empty-text post', () => {
    expect(parseArticle(articleFrom(AUTHOR + METRICS))?.text).toBe('');
  });

  it('returns null without a status link', () => {
    expect(parseArticle(articleFrom(TEXT + METRICS))).toBeNull();
  });

  it('keeps markup in text as literal characters', () => {
    const hostile = '<div data-testid="tweetText"><span>&lt;img src=x onerror=alert(1)&gt;</span></div>';
    expect(parseArticle(articleFrom(AUTHOR + hostile + METRICS))?.text).toBe('<img src=x onerror=alert(1)>');
  });
});
