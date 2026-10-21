// @covers apps/server/src/digest/**, apps/server/src/router.ts, apps/server/src/app.ts, apps/server/src/db.ts, apps/server/src/llm/**, apps/server/src/triage/**, apps/server/src/posts.ts, shared/src/types.ts, apps/extension/src/content/**, apps/extension/src/background/**, apps/extension/src/drafts/**, apps/extension/src/panel/idea-meta.ts, apps/extension/src/panel/digest-section.ts, apps/extension/src/panel/draft-actions.ts, apps/extension/src/panel/dom.ts, apps/extension/src/panel/panel.css, apps/extension/src/panel/panel.ts, apps/extension/src/server-api.ts, apps/extension/src/server-config.ts, scripts/build.mjs, e2e/x-timeline.ts, e2e/fakes/**
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
import { articleOf, captured, openTimeline, type Post, type QuotedPost } from './x-timeline';

let server: TestServer;
let binDir: string;
let context: BrowserContext;

// The fake triage scores by "[score:NN]": alice is the best ranked source (and Ready), bob and dave sit under the
// flag floor (+ Flag). A manual idea must use the post the user picked, never the best ranked one.
const ALICE: Post = { statusId: '9701', handle: 'alice', text: 'Robinhood Chain wallets keep moving into the LONG eco [score:95]', likes: 400 };
const BOB: Post = { statusId: '9702', handle: 'bob', text: 'Testing in prod is a lifestyle [score:60]' };
const DAVE: Post = { statusId: '9703', handle: 'dave', text: 'Most traders never read the docs [score:60]' };
const QUOTED: QuotedPost = { handle: DAVE.handle, text: DAVE.text };

test.beforeAll(async () => {
  context = await launchExtension();
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://x.com' });
});

test.afterAll(async () => {
  await context?.close();
  removeTempDirs();
});

test.afterEach(async () => {
  await server?.stop();
});

interface PostsBody {
  posts: { statusId: string; triage: { score: number | null } | null }[];
}

const triagedIds = async () => {
  const body = (await (await fetch(`${server.baseUrl}/v1/posts`, { headers: authHeader })).json()) as PostsBody;
  return body.posts.filter((p) => typeof p.triage?.score === 'number').map((p) => p.statusId).sort();
};

let extensionId: string;
test.beforeEach(async () => {
  const fakes = installFakeClis();
  binDir = fakes.binDir;
  const config = {
    handle: 'e2eowner',
    spacehoodRepoPath: makeTempDir('xc-repo-'),
    digest: { everyNPosts: 1000, manualMinIntervalSec: 0 },
    triage: { batchSize: 1 },
    models: { triage: 'google/fake-flash', triageFallbacks: [], final: 'fake-final' },
  };
  server = await startServer(config, { ...fakes.env, GEMINI_API_KEY: 'fake-gemini-key-for-e2e' });
  expect((await postJson(server.baseUrl, '/v1/posts', { posts: [ALICE, BOB, DAVE].map(captured) })).ok).toBe(true);
  await expect.poll(triagedIds).toEqual([ALICE, BOB, DAVE].map((p) => p.statusId));
  extensionId = await pointExtensionAtServer(context, server.baseUrl);
});

const lastPrompt = () => readFileSync(join(binDir, 'opencode-digest-prompt.txt'), 'utf8');
const promptSourceIds = (prompt: string) => {
  const block = prompt.slice(prompt.lastIndexOf('<source-posts>\n'));
  return [...block.matchAll(/"statusId":"(\d+)"/g)].map((m) => m[1]);
};
const composerHits = (page: Page) => page.evaluate(() => (window as unknown as { __composer: object }).__composer);
const leakedClicks = (page: Page) => page.evaluate(() => (window as unknown as { __leaked: number }).__leaked);

async function expectSourcedIdea(idea: Locator, kind: string, post: Post): Promise<void> {
  await expect(idea.getByTestId('idea-kind')).toHaveText(kind);
  await expect(idea.getByTestId('idea-source')).toContainText(`@${post.handle}: ${post.text}`);
  await expect(idea.getByRole('link', { name: 'Open post' })).toHaveAttribute('href', `https://x.com/${post.handle}/status/${post.statusId}`);
}

test("in X's Quote composer, Generate makes a quote idea for the quoted post, with the author in the header and no kind chips", async () => {
  const page = await openTimeline(context, [], [], { composer: true, quoted: QUOTED });
  await page.evaluate(() => (window as unknown as { __openQuoteModal: () => void }).__openQuoteModal());
  const quoteComposer = page.getByRole('region', { name: 'Quote modal composer' });
  await quoteComposer.getByRole('button', { name: 'Ideas', exact: true }).click();

  const card = page.getByTestId('compose-ideas-card');
  await expect(card.getByTestId('compose-quoting')).toHaveText(`Quoting @dave: ${DAVE.text}`);
  await expect(card.getByRole('group', { name: 'Idea kind' })).toHaveCount(0);
  await card.getByRole('button', { name: 'Generate idea' }).click();
  const newest = card.getByTestId('compose-idea').first();
  await expect(newest.getByTestId('compose-idea-text')).toHaveText('Fake idea 1');
  // The quoted card has no status link: the captured post is found by author and text.
  await expectSourcedIdea(newest, 'Quote', DAVE);
  const prompt = lastPrompt();
  expect(prompt).toContain('these kinds, in this order: ["quote"]');
  expect(promptSourceIds(prompt)).toEqual([DAVE.statusId]);

  // The home composer is no quote composer: its chips are back and nothing says Quoting.
  await page.getByRole('region', { name: 'Home composer' }).getByRole('button', { name: 'Ideas', exact: true }).click();
  await expect(card.getByRole('group', { name: 'Idea kind' }).getByRole('button')).toHaveText(['Mix', 'Spacehub', 'Eco', 'From timeline', 'Quote']);
  await expect(card.getByTestId('compose-quoting')).toHaveCount(0);
  await expect(quoteComposer.getByRole('textbox', { name: 'Post text' })).toHaveText('Half-written post');
  expect(await composerHits(page)).toEqual({ leaked: 0, posted: 0 });
  await page.close();
});

test('"Post idea" on a timeline post (in the Ready card, or beside + Flag) gives an inspired idea for that post, shown with Copy and in the Digest tab', async () => {
  const page = await openTimeline(context, [ALICE]);
  const ready = articleOf(page, ALICE).getByTestId('inline-draft-badge');
  await expect(ready).toHaveText('Ready', { timeout: 15_000 });
  await ready.click();
  const readyIdea = page.getByTestId('inline-draft-card').getByTestId('post-idea');
  await readyIdea.getByRole('button', { name: 'Post idea' }).click();
  const aliceIdea = readyIdea.getByTestId('post-idea-result');
  await expect(aliceIdea.getByTestId('post-idea-result-text')).toHaveText('Fake idea 1');
  await expectSourcedIdea(aliceIdea, 'From timeline', ALICE);
  expect(lastPrompt()).toContain('these kinds, in this order: ["inspired"]');
  expect(promptSourceIds(lastPrompt())).toEqual([ALICE.statusId]);
  await aliceIdea.getByRole('button', { name: 'Copy' }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('Fake idea 1');
  expect(await leakedClicks(page)).toBe(0);
  await page.close();

  const flagPage = await openTimeline(context, [BOB]);
  const bob = articleOf(flagPage, BOB);
  await expect(bob.getByRole('button', { name: '+ Flag' })).toBeVisible({ timeout: 15_000 });
  await bob.getByRole('button', { name: 'Post idea' }).click();
  const flagIdea = flagPage.getByTestId('post-idea-card');
  await flagIdea.getByRole('button', { name: 'Post idea' }).click();
  await expect(flagIdea.getByTestId('post-idea-result-text')).toHaveText('Fake idea 2');
  await expectSourcedIdea(flagIdea, 'From timeline', BOB);
  expect(promptSourceIds(lastPrompt())).toEqual([BOB.statusId]);
  expect(await leakedClicks(flagPage)).toBe(0);
  await flagPage.close();

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/panel.html`);
  await panel.getByRole('tab', { name: 'Digest' }).click();
  await panel.getByTestId('digest-show-more').click();
  const rows = panel.getByTestId('digest-idea');
  await expect(rows).toHaveCount(2);
  await expectSourcedIdea(rows.filter({ hasText: 'Fake idea 2' }), 'From timeline', BOB);
  await expectSourcedIdea(rows.filter({ hasText: 'Fake idea 1' }), 'From timeline', ALICE);
  await panel.close();
});
