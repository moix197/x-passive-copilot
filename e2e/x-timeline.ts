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

// X's compose toolbar row: the media/emoji icon list, then Post.
const TOOLBAR_HTML = `<div data-testid="toolBar" style="display:flex;justify-content:space-between;align-items:center">
    <nav><div data-testid="ScrollSnap-List" role="tablist" style="display:flex;align-items:center">
      <button type="button" aria-label="Add photos or video">img</button><button type="button" aria-label="Add emoji">emoji</button>
    </div></nav>
    <button type="button" data-testid="tweetButtonInline">Post</button>
  </div>`;

// X's compose box ("What's happening?"): the text box, then the toolbar row (in a slot the fixture can re-render).
const composerHtml = (label: string) => `<div data-testid="fixture-composer" role="region" aria-label="${label}">
    <div data-testid="tweetTextarea_0" role="textbox" contenteditable="true" aria-label="Post text">Half-written post</div>
    <div data-testid="fixture-toolbar-slot">${TOOLBAR_HTML}</div>
  </div>`;

// Counts what reaches X's compose box (clicks, keys, input, Post clicks); opens the Post modal; swaps a toolbar like React does.
const composerScript = () => `
      window.__composer = { leaked: 0, posted: 0 };
      for (const type of ['click', 'mousedown', 'keydown', 'keyup', 'input']) {
        document.addEventListener(type, (e) => { if (e.target.closest && e.target.closest('[data-testid="fixture-composer"]')) window.__composer.leaked++; });
      }
      document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('[data-testid^="tweetButton"]')) window.__composer.posted++; });
      window.__openPostModal = () => {
        const layers = document.createElement('div');
        layers.dataset.testid = 'layers';
        layers.innerHTML = ${JSON.stringify(`<div role="dialog" aria-modal="true" aria-label="Post modal">${composerHtml('Post modal composer')}</div>`)};
        document.body.append(layers);
      };
      window.__rerenderToolbar = (index) => {
        document.querySelectorAll('[data-testid="fixture-toolbar-slot"]')[index].innerHTML = ${JSON.stringify(TOOLBAR_HTML)};
      };`;

export interface TimelineOptions {
  /** Adds X's home composer above the timeline, plus page hooks to open the Post modal and re-render a toolbar. */
  composer?: boolean;
}

// Stands in for X: its document-level listeners count clicks and keys that leak out of an article.
function timelineHtml(posts: Post[], options: TimelineOptions = {}): string {
  const html = Object.fromEntries(posts.map((p) => [p.statusId, articleHtml(p)]));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Home / X (fixture)</title></head><body>
    <div data-testid="primaryColumn">${options.composer ? composerHtml('Home composer') : ''}<section id="timeline" style="overflow:hidden;transform:translateY(0);width:600px;height:240px">${Object.values(html).join('')}</section></div>
    <div style="height:3000px"></div><script>
      window.__articleHtml = ${JSON.stringify(html)};
      window.__leaked = 0;
      for (const type of ['click', 'mousedown', 'keydown']) {
        document.addEventListener(type, (e) => { if (e.target.closest && e.target.closest('article')) window.__leaked++; });
      }${options.composer ? composerScript() : ''}
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

export async function openTimeline(
  context: BrowserContext,
  posts: Post[],
  requests: string[] = [],
  options: TimelineOptions = {},
): Promise<Page> {
  await context.route('https://x.com/**', (route) => route.fulfill({ contentType: 'text/html', body: timelineHtml(posts, options) }));
  const page = await context.newPage();
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('https://x.com/home');
  return page;
}

export const articleOf = (page: Page, post: Post) => page.getByRole('article').filter({ hasText: post.text });
