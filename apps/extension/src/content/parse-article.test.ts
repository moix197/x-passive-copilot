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
      replyTo: [],
      quotedStatusId: null,
      avatarUrl: null,
    });
  });

  it('uses the outer author and text for a quote post', () => {
    const quote = `<div role="link">
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
    const quote = `<div role="link"><div data-testid="User-Name"><a href="/carol">Carol</a></div><a href="/carol/status/2002"><time>x</time></a>
      <div data-testid="tweetText"><span>inner</span></div></div>`;
    expect(parseArticle(articleFrom(AUTHOR + quote + METRICS))?.text).toBe('');
  });

  it('tags replies', () => {
    const reply = '<div><span>Replying to @bob</span></div>';
    expect(parseArticle(articleFrom(reply + AUTHOR + TEXT + METRICS))?.isReply).toBe(true);
    const es = '<div>En respuesta a @bob</div>';
    expect(parseArticle(articleFrom(es + AUTHOR + TEXT + METRICS))?.isReply).toBe(true);
  });

  it('captures reply-target handles from the reply context', () => {
    const reply = '<div>Replying to <a href="/Bob"><span>@Bob</span></a> and <a href="/carol_x">@carol_x</a></div>';
    expect(parseArticle(articleFrom(reply + AUTHOR + TEXT + METRICS))?.replyTo).toEqual(['Bob', 'carol_x']);
    const es = '<div>En respuesta a <a href="/me">@me</a></div>';
    expect(parseArticle(articleFrom(es + AUTHOR + TEXT + METRICS))?.replyTo).toEqual(['me']);
  });

  it('caps reply targets and ignores mentions in the body', () => {
    const many = Array.from({ length: 12 }, (_, i) => `@user${i}`).join(' ');
    const reply = `<div>Replying to ${many}</div>`;
    expect(parseArticle(articleFrom(reply + AUTHOR + TEXT + METRICS))?.replyTo).toHaveLength(10);
    const body = '<div data-testid="tweetText"><span>Replying to @someone</span></div>';
    expect(parseArticle(articleFrom(AUTHOR + body + METRICS))?.replyTo).toEqual([]);
  });

  it('does not treat reply-like body text as a reply', () => {
    const text = '<div data-testid="tweetText"><span>Replying to everyone</span></div>';
    expect(parseArticle(articleFrom(AUTHOR + text + METRICS))?.isReply).toBe(false);
  });

  it('does not treat a link card as a quote', () => {
    const card = '<div role="link"><span>example.com</span></div>';
    expect(parseArticle(articleFrom(AUTHOR + TEXT + card + METRICS))?.quotedStatusId).toBeNull();
  });

  it('keeps video posts wrapped in placementTracking', () => {
    const video = '<div data-testid="placementTracking"><video></video></div>';
    expect(parseArticle(articleFrom(AUTHOR + TEXT + video + METRICS))?.statusId).toBe('1001');
  });

  it('skips promoted posts (no time element)', () => {
    const ad = `<div data-testid="User-Name"><a href="/brand">Brand</a></div><span>Ad</span>
      <a href="/brand/status/1004"><span>brand.example</span></a>`;
    expect(parseArticle(articleFrom(ad + TEXT + METRICS))).toBeNull();
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

  it('reads the outer author avatar from the X image CDN only', () => {
    const src = 'https://pbs.twimg.com/profile_images/123/a-b_normal.jpg';
    const avatar = (url: string) => `<div data-testid="Tweet-User-Avatar"><img src="${url}" alt=""></div>`;
    expect(parseArticle(articleFrom(avatar(src) + AUTHOR + TEXT))?.avatarUrl).toBe(src);
    expect(parseArticle(articleFrom(avatar('https://evil.example/x.png') + AUTHOR + TEXT))?.avatarUrl).toBeNull();
    expect(parseArticle(articleFrom(avatar('javascript:alert(1)') + AUTHOR + TEXT))?.avatarUrl).toBeNull();
  });

  it('does not take a quoted author avatar for the outer post', () => {
    const quote = `<div role="link"><div data-testid="Tweet-User-Avatar"><img src="https://pbs.twimg.com/q.jpg"></div>
      <div data-testid="User-Name"><a href="/carol">Carol</a></div><a href="/carol/status/2002"><time>x</time></a></div>`;
    expect(parseArticle(articleFrom(AUTHOR + TEXT + quote))?.avatarUrl).toBeNull();
  });
});
