// @covers apps/server/src/posts.ts, apps/server/src/triage/**, shared/src/config.ts, apps/extension/src/panel/flagged-feeds.ts, apps/extension/src/panel/flagged-view.ts, apps/extension/src/content/**, e2e/x-timeline.ts, e2e/fakes/opencode.mjs
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  installFakeClis,
  launchExtension,
  makeTempDir,
  pointExtensionAtServer,
  postJson,
  removeTempDirs,
  startServer,
  type TestServer,
} from './harness';
import { articleOf, captured, openTimeline, type Post } from './x-timeline';

const BELOW: Post = { statusId: '9501', handle: 'someone', text: 'Reply-worthy but just under the floor [score:79]' };
const ABOVE: Post = { statusId: '9502', handle: 'someone', text: 'Reply-worthy and clear of the floor [score:85]' };
const WATCHED: Post = { statusId: '9503', handle: 'watched', text: 'Watchlist post the model scored low [score:10]' };
const MINE = [BELOW, ABOVE, WATCHED].map((p) => p.statusId);

let server: TestServer;
let context: BrowserContext;
let extensionId: string;

test.beforeAll(async () => {
  const fakes = installFakeClis();
  const config = {
    handle: 'e2eowner',
    watchlist: ['watched'],
    spacehoodRepoPath: makeTempDir('xc-repo-'),
    models: { triage: 'google/fake-flash', final: 'fake-final' },
    triage: { batchSize: 1 },
  };
  server = await startServer(config, { ...fakes.env, GEMINI_API_KEY: 'fake-gemini-key-for-e2e' });
  context = await launchExtension();
  extensionId = await pointExtensionAtServer(context, server.baseUrl);
});

test.afterAll(async () => {
  await context?.close();
  await server?.stop();
  removeTempDirs();
});

const rowIds = (panel: Page) =>
  panel
    .getByTestId('flagged-row')
    .evaluateAll((rows) => rows.map((r) => (r as HTMLElement).dataset.statusId ?? ''))
    .then((ids) => ids.filter((id) => MINE.includes(id)).sort());

test('a reply-worthy post scored 79 is not in To reply and gets no pill; 85 is flagged; a low-scored watchlist post still shows', async () => {
  expect((await postJson(server.baseUrl, '/v1/posts', { posts: [BELOW, ABOVE, WATCHED].map(captured) })).ok).toBe(true);

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 400, height: 1100 });
  await panel.goto(`chrome-extension://${extensionId}/panel.html`);
  await panel.getByRole('tab', { name: 'Flagged' }).click();
  await expect.poll(() => rowIds(panel)).toEqual([ABOVE.statusId, WATCHED.statusId]);
  await expect(panel.locator(`[data-status-id="${BELOW.statusId}"]`)).toHaveCount(0);

  const page = await openTimeline(context, [BELOW, ABOVE, WATCHED]);
  await expect(articleOf(page, ABOVE).getByTestId('inline-draft-badge')).toHaveText('Ready', { timeout: 15_000 });
  await expect(articleOf(page, WATCHED).getByTestId('inline-draft-badge')).toHaveText('Ready');
  await expect(articleOf(page, BELOW).getByTestId('inline-flag-pill')).toHaveText('+ Flag');
  await expect(articleOf(page, BELOW).getByTestId('inline-draft-badge')).toHaveCount(0);
  await page.close();
  await panel.close();
});
