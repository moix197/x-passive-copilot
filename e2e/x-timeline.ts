import type { BrowserContext, Page } from '@playwright/test';

/** Fake x.com timeline for the inline pill specs: articles shaped like X's, captured posts to match. */

export const HOUR = 3_600_000;

export interface Post {
  statusId: string;
  handle: string;
  text: string;
  /** How long ago it was posted; 2h when omitted. */
  ageMs?: number;
  likes?: number;
}

const postedAt = (post: Post) => new Date(Date.now() - (post.ageMs ?? 2 * HOUR)).toISOString();

function articleHtml(post: Post): string {
  const likes = post.likes ?? 40;
  return `<article data-testid="tweet">
    <div data-testid="User-Name"><a href="/${post.handle}"><span>${post.handle}</span></a></div>
    <a href="/${post.handle}/status/${post.statusId}"><time datetime="${postedAt(post)}">2h</time></a>
    <div data-testid="tweetText"><span>${post.text}</span></div>
    <div role="group" aria-label="2 replies, 3 reposts, ${likes} likes, 900 views" style="display:flex;justify-content:space-between;align-items:center;overflow:hidden">
      <button type="button" aria-label="Reply">2</button><button type="button" aria-label="Repost">3</button>
      <button type="button" aria-label="Like">${likes}</button><span>900</span>
    </div>
  </article>`;
}

// Stands in for X: its document-level listeners count clicks and keys that leak out of an article.
function timelineHtml(posts: Post[]): string {
  const html = Object.fromEntries(posts.map((p) => [p.statusId, articleHtml(p)]));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Home / X (fixture)</title></head><body>
    <div data-testid="primaryColumn"><section id="timeline" style="overflow:hidden;transform:translateY(0);width:600px;height:240px">${Object.values(html).join('')}</section></div>
    <div style="height:3000px"></div><script>
      window.__articleHtml = ${JSON.stringify(html)};
      window.__leaked = 0;
      for (const type of ['click', 'mousedown', 'keydown']) {
        document.addEventListener(type, (e) => { if (e.target.closest && e.target.closest('article')) window.__leaked++; });
      }
    </script></body></html>`;
}

/** The post as the content script would have captured it. */
export const captured = (post: Post) => ({
  statusId: post.statusId,
  authorName: post.handle,
  authorHandle: post.handle,
  text: post.text,
  postedAt: postedAt(post),
  metrics: { replies: 2, reposts: 3, likes: post.likes ?? 40, views: 900 },
  isReply: false,
  replyTo: [],
  quotedStatusId: null,
});

export async function openTimeline(context: BrowserContext, posts: Post[], requests: string[] = []): Promise<Page> {
  await context.route('https://x.com/**', (route) => route.fulfill({ contentType: 'text/html', body: timelineHtml(posts) }));
  const page = await context.newPage();
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('https://x.com/home');
  return page;
}

export const articleOf = (page: Page, post: Post) => page.getByRole('article').filter({ hasText: post.text });
