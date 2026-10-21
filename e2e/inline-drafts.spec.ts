// @covers apps/extension/src/content/**, apps/extension/src/background/**, apps/extension/src/drafts/**, apps/extension/src/server-api.ts, apps/extension/src/server-config.ts, apps/extension/src/panel/draft-actions.ts, apps/extension/src/panel/dom.ts, apps/extension/src/panel/panel.css, apps/extension/manifest.json, scripts/build.mjs, apps/server/src/posts.ts, apps/server/src/router.ts, apps/server/src/polish/**, apps/server/src/voice/feedback.ts, apps/server/src/triage/**, shared/src/types.ts, e2e/fakes/**
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  authHeader,
  installFakeClis,
  launchExtension,
  makeTempDir,
  pointExtensionAtServer,
  postJson,
  removeTempDirs,
  startServer,
  type TestServer,
} from './harness';

const HOUR = 3_600_000;
interface Post {
  statusId: string;
  handle: string;
  text: string;
}

const flagged = (statusId: string, text: string): Post => ({ statusId, handle: 'someone', text });
const OWN: Post = { statusId: '9102', handle: 'e2eowner', text: 'My own post, never flagged' };

let server: TestServer;
let context: BrowserContext;

test.beforeAll(async () => {
  const fakes = installFakeClis();
  const config = {
    handle: 'e2eowner',
    spacehoodRepoPath: makeTempDir('xc-repo-'),
    models: { triage: 'google/fake-flash', final: 'fake-final' },
    triage: { batchSize: 1 },
  };
  server = await startServer(config, { ...fakes.env, GEMINI_API_KEY: 'fake-gemini-key-for-e2e' });
  context = await launchExtension();
  await pointExtensionAtServer(context, server.baseUrl);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://x.com' });
});

test.afterAll(async () => {
  await context?.close();
  await server?.stop();
  removeTempDirs();
});

function articleHtml(post: Post): string {
  return `<article data-testid="tweet">
    <div data-testid="User-Name"><a href="/${post.handle}"><span>${post.handle}</span></a></div>
    <a href="/${post.handle}/status/${post.statusId}"><time datetime="${new Date(Date.now() - 2 * HOUR).toISOString()}">2h</time></a>
    <div data-testid="tweetText"><span>${post.text}</span></div>
    <div role="group" aria-label="2 replies, 3 reposts, 40 likes, 900 views" style="display:flex;justify-content:space-between;align-items:center;overflow:hidden">
      <button type="button" aria-label="Reply">2</button><button type="button" aria-label="Repost">3</button>
      <button type="button" aria-label="Like">40</button><span>900</span>
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

const captured = (post: Post) => ({
  statusId: post.statusId,
  authorName: post.handle,
  authorHandle: post.handle,
  text: post.text,
  postedAt: new Date(Date.now() - 2 * HOUR).toISOString(),
  metrics: { replies: 2, reposts: 3, likes: 40, views: 900 },
  isReply: false,
  replyTo: [],
  quotedStatusId: null,
});

interface ApiPost {
  statusId: string;
  copiedAt: number | null;
  repliedAt: number | null;
  triage: { roughDraft: string | null } | null;
  polish: { versions: unknown[] } | null;
}

async function apiPost(statusId: string): Promise<ApiPost | undefined> {
  const res = await fetch(`${server.baseUrl}/v1/posts?limit=100`, { headers: authHeader });
  return ((await res.json()) as { posts: ApiPost[] }).posts.find((p) => p.statusId === statusId);
}

async function seedTriaged(post: Post): Promise<string> {
  expect((await postJson(server.baseUrl, '/v1/posts', { posts: [captured(post)] })).ok).toBe(true);
  await expect.poll(async () => (await apiPost(post.statusId))?.triage?.roughDraft ?? null, { timeout: 20_000 }).not.toBeNull();
  return (await apiPost(post.statusId))?.triage?.roughDraft ?? '';
}

async function openTimeline(posts: Post[], requests: string[] = []): Promise<Page> {
  await context.route('https://x.com/**', (route) => route.fulfill({ contentType: 'text/html', body: timelineHtml(posts) }));
  const page = await context.newPage();
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('https://x.com/home');
  return page;
}

const articleOf = (page: Page, post: Post) => page.getByRole('article').filter({ hasText: post.text });

function replaceArticle(page: Page, post: Post, mode: 'fresh' | 'clone'): Promise<void> {
  return page.evaluate(
    ([statusId, how]) => {
      const w = window as unknown as { __articleHtml: Record<string, string> };
      const old = [...document.querySelectorAll('article')].find((a) => a.innerHTML.includes(`/status/${statusId}`))!;
      const template = document.createElement('template');
      template.innerHTML = w.__articleHtml[statusId]!;
      old.replaceWith(how === 'clone' ? old.cloneNode(true) : template.content.firstElementChild!);
    },
    [post.statusId, mode] as const,
  );
}

test('a flagged post on x.com gets one Ready pill in its action bar; clicking opens the popover with the draft; Copy copies, records it and opens no tab', async () => {
  const FLAGGED = flagged('9101', 'Inline flagged post about shipping');
  const rough = await seedTriaged(FLAGGED);
  expect((await postJson(server.baseUrl, '/v1/posts', { posts: [captured(OWN)] })).ok).toBe(true);
  const requests: string[] = [];
  const page = await openTimeline([FLAGGED, OWN], requests);
  const article = articleOf(page, FLAGGED);

  const badge = article.getByTestId('inline-draft-badge');
  await expect(badge).toHaveText('Ready', { timeout: 15_000 });
  await expect(page.getByTestId('inline-draft-badge')).toHaveCount(1);
  await expect(article.getByRole('group').getByTestId('inline-draft-badge')).toHaveCount(1);
  const card = page.getByTestId('inline-draft-card');
  await expect(card).toHaveCount(0);
  const heightBefore = (await article.boundingBox())!.height;
  await badge.click();
  expect((await article.boundingBox())!.height).toBe(heightBefore);
  await expect(card).toBeVisible();
  const box = (await card.boundingBox())!;
  const view = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(view.width);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(view.height);
  await expect(badge).toHaveAttribute('aria-expanded', 'true');
  await expect(card).toContainText('First draft');
  await expect(card.getByTestId('inline-draft-text')).toHaveText(rough);
  await expect(card.getByTestId('draft-edit')).toHaveCount(0);

  const pagesBefore = context.pages().length;
  await card.getByTestId('draft-copy').click();
  await expect(card.getByTestId('copied-badge')).toHaveText('Copied ✓');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(rough);
  await expect.poll(async () => (await apiPost(FLAGGED.statusId))?.copiedAt ?? null).not.toBeNull();
  expect((await apiPost(FLAGGED.statusId))?.repliedAt).toBeNull();
  expect(context.pages()).toHaveLength(pagesBefore);
  await card.getByTestId('draft-copy').press('l');

  expect(await page.evaluate(() => (window as unknown as { __leaked: number }).__leaked)).toBe(0);
  expect(requests.filter((url) => url.includes('127.0.0.1'))).toEqual([]);
  await page.close();
});

test('the pill re-attaches, once, after X replaces or clones the article node', async () => {
  const FLAGGED = flagged('9201', 'Inline post that X re-renders');
  await seedTriaged(FLAGGED);
  const page = await openTimeline([FLAGGED]);
  const badges = page.getByTestId('inline-draft-badge');
  await expect(articleOf(page, FLAGGED).getByTestId('inline-draft-badge')).toBeVisible({ timeout: 15_000 });

  await replaceArticle(page, FLAGGED, 'fresh');
  await expect(articleOf(page, FLAGGED).getByTestId('inline-draft-badge')).toBeVisible();
  await expect(badges).toHaveCount(1);

  await replaceArticle(page, FLAGGED, 'clone');
  await expect(articleOf(page, FLAGGED).getByTestId('inline-draft-badge')).toBeVisible();
  await expect(badges).toHaveCount(1);

  await page.evaluate(() => document.getElementById('timeline')!.append(document.createElement('div')));
  await expect(badges).toHaveCount(1);
  await articleOf(page, FLAGGED).getByTestId('inline-draft-badge').click();
  await expect(page.getByTestId('inline-draft-text')).toBeVisible();
  await page.close();
});

test('Polish, Regenerate and thumbs work from the inline card', async () => {
  const FLAGGED = flagged('9301', 'Inline post to polish');
  await seedTriaged(FLAGGED);
  const page = await openTimeline([FLAGGED]);
  const article = articleOf(page, FLAGGED);
  await article.getByTestId('inline-draft-badge').click({ timeout: 15_000 });
  const card = page.getByTestId('inline-draft-card');

  await card.getByTestId('polish-button').click();
  await expect(card).toContainText('Claude version', { timeout: 20_000 });
  await expect.poll(async () => (await apiPost(FLAGGED.statusId))?.polish?.versions.length ?? 0).toBe(1);
  const first = await card.getByTestId('inline-draft-text').textContent();

  await card.getByTestId('draft-regenerate').click();
  await expect.poll(async () => (await apiPost(FLAGGED.statusId))?.polish?.versions.length ?? 0, { timeout: 20_000 }).toBe(2);
  await expect(card.getByTestId('inline-draft-text')).not.toHaveText(first ?? '', { timeout: 15_000 });

  await card.getByTestId('draft-up').click();
  await expect(card.getByTestId('draft-up')).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await article.getByTestId('inline-draft-badge').click({ timeout: 15_000 });
  await expect(card.getByTestId('draft-up')).toHaveAttribute('aria-pressed', 'true');
  await page.close();
});

test('the popover closes on Escape, on an outside click and on a second pill click', async () => {
  const FLAGGED = flagged('9501', 'Inline post for popover closing');
  await seedTriaged(FLAGGED);
  const page = await openTimeline([FLAGGED]);
  const badge = articleOf(page, FLAGGED).getByTestId('inline-draft-badge');
  const card = page.getByTestId('inline-draft-card');

  for (const close of [
    () => page.keyboard.press('Escape'),
    () => page.mouse.click(5, 300),
    () => badge.click(),
  ]) {
    await badge.click({ timeout: 15_000 });
    await expect(badge).toHaveAttribute('aria-expanded', 'true');
    await expect(card).toBeVisible();
    await close();
    await expect(card).toHaveCount(0);
    await expect(badge).toHaveAttribute('aria-expanded', 'false');
  }

  await badge.click();
  await expect(card).toBeVisible();
  await page.mouse.wheel(0, 200);
  await expect(card).toHaveCount(0);
  await page.close();
});

test('to-reply lookup route: token required, ids validated, only unreplied flagged posts come back', async () => {
  const post = flagged('9401', 'Inline post already replied');
  await seedTriaged(post);
  const lookup = (ids: string, headers: Record<string, string> = authHeader) =>
    fetch(`${server.baseUrl}/v1/posts/to-reply?ids=${ids}`, { headers });
  const idsOf = async (ids: string) => ((await (await lookup(ids)).json()) as { posts: { statusId: string }[] }).posts.map((p) => p.statusId);

  expect((await lookup('9401', {})).status).toBe(401);
  for (const bad of ['', 'abc', '9401,x', Array.from({ length: 101 }, (_, i) => String(i + 1)).join(',')]) {
    expect((await lookup(bad)).status).toBe(400);
  }
  expect(await idsOf('9401,9401,123456789')).toEqual(['9401']);
  expect((await postJson(server.baseUrl, '/v1/posts/9401/replied', { replied: true })).ok).toBe(true);
  expect(await idsOf('9401')).toEqual([]);
});
