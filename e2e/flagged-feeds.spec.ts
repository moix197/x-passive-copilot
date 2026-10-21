// @covers apps/extension/src/panel/flagged-feeds.ts, apps/extension/src/panel/flagged-view.ts, apps/extension/src/panel/posts-view.ts, apps/extension/src/panel/draft-actions.ts, apps/extension/src/panel/panel.ts, apps/extension/src/panel/x-tab.ts, apps/extension/src/panel/post-card.ts, apps/extension/src/panel/panel.css, apps/extension/src/server-api.ts, apps/extension/manifest.json, apps/server/src/posts.ts, apps/server/src/router.ts, apps/server/src/db.ts, shared/src/types.ts, e2e/fakes/opencode.mjs, apps/server/src/triage/**, apps/server/src/app.ts
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  authHeader,
  fakeTwimg,
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
let server: TestServer;
let context: BrowserContext;
let binDir: string;
let extensionId: string;

test.beforeAll(async () => {
  const fakes = installFakeClis();
  binDir = fakes.binDir;
  const config = {
    handle: 'e2eowner',
    spacehoodRepoPath: makeTempDir('xc-repo-'),
    models: { triage: 'google/fake-flash', final: 'fake-final' },
    triage: { batchSize: 1 },
  };
  server = await startServer(config, { ...fakes.env, GEMINI_API_KEY: 'fake-gemini-key-for-e2e' });
  context = await launchExtension();
  await fakeTwimg(context);
  extensionId = await pointExtensionAtServer(context, server.baseUrl);
});

test.afterAll(async () => {
  await context?.close();
  await server?.stop();
  removeTempDirs();
});

const holdFile = () => join(binDir, 'triage-hold.txt');
test.afterEach(() => rmSync(holdFile(), { force: true }));

function capturedPost(statusId: string, text: string) {
  return {
    statusId,
    authorName: 'N',
    authorHandle: 'someone',
    text,
    postedAt: new Date(Date.now() - 2 * HOUR).toISOString(),
    metrics: { replies: 2, reposts: 3, likes: 40, views: 900 },
    isReply: false,
    replyTo: [],
    quotedStatusId: null,
  };
}

const ingest = async (...posts: ReturnType<typeof capturedPost>[]) =>
  expect((await postJson(server.baseUrl, '/v1/posts', { posts })).ok).toBe(true);

async function openFlagged(): Promise<Page> {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 400, height: 1100 });
  await panel.goto(`chrome-extension://${extensionId}/panel.html`);
  await panel.getByRole('tab', { name: 'Flagged' }).click();
  return panel;
}

const rowIds = (panel: Page, mine: string[]) =>
  panel
    .getByTestId('flagged-row')
    .evaluateAll((rows) => rows.map((r) => (r as HTMLElement).dataset.statusId ?? ''))
    .then((ids) => ids.filter((id) => mine.includes(id)));

const row = (panel: Page, statusId: string) => panel.locator(`[data-status-id="${statusId}"]`);

test('To reply orders newest flagged first whatever the score, pending posts included; Replied is newest replied first; Move back returns a card; all survive reload', async () => {
  const mine = ['6101', '6102', '6103', '6104'];
  await ingest(
    capturedPost('6101', 'low one [score:40]'),
    capturedPost('6102', 'high one [score:80]'),
    capturedPost('6103', 'middle one [score:60]'),
  );
  const panel = await openFlagged();
  await expect.poll(() => rowIds(panel, mine)).toEqual(['6103', '6102', '6101']);

  writeFileSync(holdFile(), 'hold');
  await ingest({ ...capturedPost('6104', '@e2eowner pending mention'), authorHandle: 'orderer' });
  await expect.poll(() => rowIds(panel, mine)).toEqual(['6104', '6103', '6102', '6101']);
  await expect(row(panel, '6104')).toContainText('triage pending');
  rmSync(holdFile(), { force: true });

  await row(panel, '6101').getByTestId('mark-replied').click();
  await expect(row(panel, '6101')).toHaveCount(0);
  await row(panel, '6103').getByTestId('mark-replied').click();
  await expect(row(panel, '6103')).toHaveCount(0);
  await expect(panel.getByTestId('feed-replied')).toContainText('Replied (2)');

  await panel.getByTestId('feed-replied').click();
  await expect.poll(() => rowIds(panel, mine)).toEqual(['6103', '6101']);
  await expect(row(panel, '6103').getByTestId('move-back')).toHaveText('Move back to To reply');

  const reloaded = await openFlagged();
  await expect(reloaded.getByTestId('feed-to-reply')).toContainText('To reply (');
  await expect.poll(() => rowIds(reloaded, mine)).toEqual(['6104', '6102']);
  await reloaded.getByTestId('feed-replied').click();
  await expect.poll(() => rowIds(reloaded, mine)).toEqual(['6103', '6101']);

  await row(reloaded, '6101').getByTestId('move-back').click();
  await expect(row(reloaded, '6101')).toHaveCount(0);
  await reloaded.getByTestId('feed-to-reply').click();
  await expect.poll(() => rowIds(reloaded, mine)).toEqual(['6104', '6102', '6101']);
  await expect(reloaded.getByTestId('feed-replied')).toContainText('Replied (1)');
});

const postPageUrl = (statusId: string) => `https://x.com/someone/status/${statusId}`;

async function storedPost(statusId: string) {
  const res = await fetch(`${server.baseUrl}/v1/posts?limit=100`, { headers: authHeader });
  const body = (await res.json()) as { posts: { statusId: string; copiedAt: number | null; repliedAt: number | null }[] };
  return body.posts.find((p) => p.statusId === statusId);
}

// Read through chrome.tabs: a tab the extension opens is not routed by Playwright, so its page URL is an error page.
async function tabUrls(query: chrome.tabs.QueryInfo): Promise<string[]> {
  const worker = context.serviceWorkers()[0]!;
  return worker.evaluate(async (q) => (await chrome.tabs.query(q)).map((t) => t.pendingUrl ?? t.url ?? ''), query);
}

const tabsAt = async (url: string) => (await tabUrls({})).filter((u) => u === url).length;

async function copyOpensTab(panel: Page, statusId: string, scope: 'first-draft' | 'claude-version'): Promise<void> {
  expect(await tabsAt(postPageUrl(statusId))).toBe(0);
  await row(panel, statusId).getByTestId(scope).getByTestId('draft-copy').click();
  await expect.poll(() => tabsAt(postPageUrl(statusId))).toBe(1);
  // The real panel is a side panel and stays visible; this tab went to the background.
  await panel.bringToFront();
}

test('Copy keeps the post in To reply with a Copied badge and opens it on X, focusing an open tab; Mark replied moves it', async () => {
  const mine = ['6201', '6202'];
  await ingest(capturedPost('6201', 'copy first draft'), capturedPost('6202', 'copy claude version'));
  const panel = await openFlagged();

  await expect(row(panel, '6201').getByTestId('first-draft')).toContainText('Congrats on shipping!', { timeout: 20_000 });
  await copyOpensTab(panel, '6201', 'first-draft');
  await expect(row(panel, '6201').getByTestId('copied-badge')).toHaveText('Copied ✓');
  await expect.poll(async () => (await storedPost('6201'))?.copiedAt ?? null).not.toBeNull();
  expect((await storedPost('6201'))?.repliedAt).toBeNull();

  const claude = row(panel, '6202').getByTestId('claude-version');
  await claude.getByTestId('polish-button').click({ timeout: 20_000 });
  await expect(claude.getByTestId('claude-text')).toBeVisible({ timeout: 20_000 });
  await copyOpensTab(panel, '6202', 'claude-version');
  await expect(row(panel, '6202').getByTestId('copied-badge')).toBeVisible();

  await row(panel, '6201').getByTestId('first-draft').getByTestId('draft-copy').click();
  await expect.poll(() => tabUrls({ active: true })).toContain(postPageUrl('6201'));
  expect(await tabsAt(postPageUrl('6201'))).toBe(1);

  const reloaded = await openFlagged();
  await expect.poll(() => rowIds(reloaded, mine)).toEqual(expect.arrayContaining(mine));
  for (const id of mine) await expect(row(reloaded, id).getByTestId('copied-badge')).toBeVisible();

  await row(reloaded, '6201').getByTestId('mark-replied').click();
  await expect(row(reloaded, '6201')).toHaveCount(0);
  await expect.poll(async () => (await storedPost('6201'))?.repliedAt ?? null).not.toBeNull();
  await reloaded.getByTestId('feed-replied').click();
  await expect.poll(() => rowIds(reloaded, mine)).toEqual(['6201']);
});

test('a failed triage shows Retry; retrying shows pending, then the new draft', async () => {
  const failFile = join(binDir, 'triage-fail.txt');
  writeFileSync(failFile, 'x');
  await ingest({ ...capturedPost('6301', '@e2eowner did triage break?'), authorHandle: 'orderer' });
  const panel = await openFlagged();
  await expect(row(panel, '6301')).toContainText('triage error', { timeout: 30_000 });
  rmSync(failFile, { force: true });
  writeFileSync(holdFile(), 'x');
  await row(panel, '6301').getByTestId('retriage-button').click();
  await expect(row(panel, '6301')).toContainText('triage pending');
  await expect(row(panel, '6301').getByTestId('retriage-button')).toHaveCount(0);

  rmSync(holdFile(), { force: true });
  await expect(row(panel, '6301')).toContainText('Congrats on shipping');
  await expect(row(panel, '6301')).not.toContainText('triage error');
});

test('retriage route: token required, unknown post 404, post without a failure 409', async () => {
  await ingest(capturedPost('6302', 'plain healthy post'));
  await expect.poll(async () => {
    const res = await fetch(`${server.baseUrl}/v1/posts?limit=50`, { headers: authHeader });
    const body = (await res.json()) as { posts: { statusId: string; triage: { score: number | null } | null }[] };
    return body.posts.find((p) => p.statusId === '6302')?.triage?.score ?? null;
  }).not.toBeNull();
  const call = (id: string, headers?: Record<string, string>) =>
    fetch(`${server.baseUrl}/v1/posts/${id}/retriage`, { method: 'POST', headers });
  expect((await call('6302')).status).toBe(401);
  expect((await call('999999', authHeader)).status).toBe(404);
  expect((await call('6302', authHeader)).status).toBe(409);
});
