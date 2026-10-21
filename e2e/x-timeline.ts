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

/** The post X embeds under the text box after the user clicks Quote. */
export interface QuotedPost {
  handle: string;
  text: string;
  /** Only when the card links the post; X's composer usually shows none. */
  statusId?: string;
}

// X's quoted-post card: a role=link box with the author line and the post text, no action bar.
const quotedCardHtml = (q: QuotedPost) => `<div role="link" tabindex="0" data-testid="fixture-quoted">
    <div data-testid="User-Name"><span>${q.handle} name</span><span>@${q.handle}</span>${q.statusId ? `<a href="/${q.handle}/status/${q.statusId}">2h</a>` : '<span>2h</span>'}</div>
    <div data-testid="tweetText"><span>${q.text}</span></div>
  </div>`;

// X's compose box ("What's happening?"): the text box, the quoted post when quoting, then the toolbar row (in a slot the fixture can re-render).
const composerHtml = (label: string, quoted?: QuotedPost) => `<div data-testid="fixture-composer" role="region" aria-label="${label}">
    <div data-testid="tweetTextarea_0" role="textbox" contenteditable="true" aria-label="Post text">Half-written post</div>
    ${quoted ? quotedCardHtml(quoted) : ''}
    <div data-testid="fixture-toolbar-slot">${TOOLBAR_HTML}</div>
  </div>`;

const modalHtml = (label: string, quoted?: QuotedPost) =>
  `<div role="dialog" aria-modal="true" aria-label="${label}">${composerHtml(`${label} composer`, quoted)}</div>`;

// Counts what reaches X's compose box (clicks, keys, input, Post clicks); opens the Post or Quote modal; swaps a toolbar like React does.
const composerScript = (quoted?: QuotedPost) => `
      window.__composer = { leaked: 0, posted: 0 };
      for (const type of ['click', 'mousedown', 'keydown', 'keyup', 'input']) {
        document.addEventListener(type, (e) => { if (e.target.closest && e.target.closest('[data-testid="fixture-composer"]')) window.__composer.leaked++; });
      }
      document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('[data-testid^="tweetButton"]')) window.__composer.posted++; });
      const openModal = (html) => {
        const layers = document.createElement('div');
        layers.dataset.testid = 'layers';
        // X's layers float over the page, so the modal never needs a scroll.
        layers.style.cssText = 'position:fixed;top:0;right:0;width:420px;background:#fff';
        layers.innerHTML = html;
        document.body.append(layers);
      };
      window.__openPostModal = () => openModal(${JSON.stringify(modalHtml('Post modal'))});
      window.__openQuoteModal = () => openModal(${JSON.stringify(quoted ? modalHtml('Quote modal', quoted) : '')});
      window.__rerenderToolbar = (index) => {
        document.querySelectorAll('[data-testid="fixture-toolbar-slot"]')[index].innerHTML = ${JSON.stringify(TOOLBAR_HTML)};
      };`;

export interface TimelineOptions {
  /** Adds X's home composer above the timeline, plus page hooks to open the Post modal and re-render a toolbar. */
  composer?: boolean;
  /** With composer: the post `__openQuoteModal()` embeds, like X's Quote composer. */
  quoted?: QuotedPost;
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
      }${options.composer ? composerScript(options.quoted) : ''}
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
