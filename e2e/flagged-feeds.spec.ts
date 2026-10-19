// @covers apps/extension/src/panel/flagged-feeds.ts, apps/extension/src/panel/flagged-view.ts, apps/extension/src/panel/posts-view.ts, apps/extension/src/panel/draft-actions.ts, apps/extension/src/panel/panel.ts, apps/server/src/posts.ts, apps/server/src/router.ts, apps/server/src/db.ts, shared/src/types.ts, e2e/fakes/opencode.mjs
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

test('To reply orders by score with pending posts on top; Replied is newest replied first; Move back returns a card; all survive reload', async () => {
  const mine = ['6101', '6102', '6103', '6104'];
  await ingest(
    capturedPost('6101', 'low one [score:40]'),
    capturedPost('6102', 'high one [score:80]'),
    capturedPost('6103', 'middle one [score:60]'),
  );
  const panel = await openFlagged();
  await expect.poll(() => rowIds(panel, mine)).toEqual(['6102', '6103', '6101']);

  writeFileSync(holdFile(), 'hold');
  await ingest({ ...capturedPost('6104', '@e2eowner pending mention'), authorHandle: 'orderer' });
  await expect.poll(() => rowIds(panel, mine)).toEqual(['6104', '6102', '6103', '6101']);
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

test('copying the first draft or the Claude version moves the post to Replied, and it stays there after reload', async () => {
  const mine = ['6201', '6202'];
  await ingest(capturedPost('6201', 'copy first draft'), capturedPost('6202', 'copy claude version'));
  const panel = await openFlagged();

  const firstDraft = row(panel, '6201').getByTestId('first-draft');
  await expect(firstDraft).toContainText('Congrats on shipping!', { timeout: 20_000 });
  await firstDraft.getByTestId('draft-copy').click();
  await expect(row(panel, '6201')).toHaveCount(0);

  const claude = row(panel, '6202').getByTestId('claude-version');
  await claude.getByTestId('polish-button').click({ timeout: 20_000 });
  await expect(claude.getByTestId('claude-text')).toBeVisible({ timeout: 20_000 });
  await claude.getByTestId('draft-copy').click();
  await expect(row(panel, '6202')).toHaveCount(0);

  await expect
    .poll(async () => {
      const res = await fetch(`${server.baseUrl}/v1/posts?view=flagged&feed=replied&limit=50`, { headers: authHeader });
      const body = (await res.json()) as { posts: { statusId: string; repliedAt: number | null }[] };
      return body.posts.filter((p) => mine.includes(p.statusId) && p.repliedAt !== null).map((p) => p.statusId);
    })
    .toEqual(['6202', '6201']);

  const reloaded = await openFlagged();
  await reloaded.getByTestId('feed-replied').click();
  await expect.poll(() => rowIds(reloaded, mine)).toEqual(['6202', '6201']);
  await expect.poll(() => rowIds(reloaded, mine).then((ids) => ids.length)).toBe(2);
  await reloaded.getByTestId('feed-to-reply').click();
  await expect.poll(() => rowIds(reloaded, mine)).toEqual([]);
});
