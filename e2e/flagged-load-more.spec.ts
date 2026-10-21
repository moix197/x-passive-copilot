// @covers apps/extension/src/panel/flagged-feeds.ts, apps/extension/src/panel/flagged-view.ts, apps/extension/src/panel/posts-view.ts, apps/extension/src/panel/panel.ts, apps/extension/src/panel/panel.css, apps/server/src/posts.ts, apps/server/src/router.ts, shared/src/types.ts
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { fakeTwimg, launchExtension, pointExtensionAtServer, postJson, removeTempDirs, startServer, type TestServer } from './harness';

const HOUR = 3_600_000;
const PAGE = 100;
const TOTAL = 105;
let server: TestServer;
let context: BrowserContext;
let extensionId: string;

// Triage stays disabled, so watchlist posts show as pending and flagged order is capture order.
test.beforeAll(async () => {
  server = await startServer({ handle: 'e2eowner', watchlist: ['bulk'] });
  context = await launchExtension();
  await fakeTwimg(context);
  extensionId = await pointExtensionAtServer(context, server.baseUrl);
});

test.afterAll(async () => {
  await context?.close();
  await server?.stop();
  removeTempDirs();
});

const bulkPost = (statusId: string) => ({
  statusId,
  authorName: 'N',
  authorHandle: 'bulk',
  text: `bulk ${statusId}`,
  postedAt: new Date(Date.now() - 2 * HOUR).toISOString(),
  metrics: { replies: 0, reposts: 0, likes: 0, views: 0 },
  isReply: false,
  replyTo: [],
  quotedStatusId: null,
});

async function ingestBulk(firstId: number, count: number): Promise<string[]> {
  const ids = Array.from({ length: count }, (_, i) => String(firstId + i));
  for (let at = 0; at < ids.length; at += 50) {
    const posts = ids.slice(at, at + 50).map(bulkPost);
    expect((await postJson(server.baseUrl, '/v1/posts', { posts })).ok).toBe(true);
  }
  return ids;
}

async function openFlagged(): Promise<Page> {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 400, height: 1100 });
  await panel.goto(`chrome-extension://${extensionId}/panel.html`);
  await panel.getByRole('tab', { name: 'Flagged' }).click();
  return panel;
}

const firstRowId = (panel: Page) => panel.getByTestId('flagged-row').first().evaluate((r) => (r as HTMLElement).dataset.statusId);

test('To reply shows 100 newest first, Load more reveals the older ones then hides; counts stay totals', async () => {
  const ids = await ingestBulk(8001, TOTAL);
  const panel = await openFlagged();
  const rows = panel.getByTestId('flagged-row');
  const loadMore = panel.getByRole('button', { name: 'Load more' });

  await expect(rows).toHaveCount(PAGE);
  await expect(panel.getByTestId('feed-to-reply')).toHaveText(`To reply (${TOTAL})`);
  expect(await firstRowId(panel)).toBe(ids[TOTAL - 1]);
  await expect(panel.locator(`[data-status-id="${ids[0]}"]`)).toHaveCount(0);

  await loadMore.click();
  await expect(rows).toHaveCount(TOTAL);
  await expect(panel.locator(`[data-status-id="${ids[0]}"]`)).toHaveCount(1);
  await expect(loadMore).toBeHidden();
  await expect(panel.getByTestId('feed-to-reply')).toHaveText(`To reply (${TOTAL})`);
});

test('Replied pages the same way, newest replied first', async () => {
  const ids = await ingestBulk(9001, PAGE + 1);
  for (const id of ids) {
    expect((await postJson(server.baseUrl, `/v1/posts/${id}/replied`, { replied: true })).ok).toBe(true);
  }
  const panel = await openFlagged();
  await panel.getByTestId('feed-replied').click();
  const rows = panel.getByTestId('flagged-row');
  const loadMore = panel.getByRole('button', { name: 'Load more' });

  await expect(rows).toHaveCount(PAGE);
  expect(await firstRowId(panel)).toBe(ids[PAGE]);
  await loadMore.click();
  await expect(rows).toHaveCount(PAGE + 1);
  await expect(loadMore).toBeHidden();
});
