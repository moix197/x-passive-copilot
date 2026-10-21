// @covers apps/server/src/digest/**, apps/server/src/router.ts, apps/server/src/app.ts, apps/server/src/db.ts, apps/server/src/llm/**, apps/server/src/triage/**, apps/server/src/posts.ts, apps/server/src/polish/polish.ts, shared/src/types.ts, apps/extension/src/content/**, apps/extension/src/background/**, apps/extension/src/drafts/idea-list.ts, apps/extension/src/panel/idea-meta.ts, apps/extension/src/panel/digest-section.ts, apps/extension/src/panel/draft-actions.ts, apps/extension/src/panel/dom.ts, apps/extension/src/panel/panel.css, apps/extension/src/panel/panel.ts, apps/extension/src/server-api.ts, apps/extension/src/server-config.ts, scripts/build.mjs, e2e/x-timeline.ts, e2e/fakes/**
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IdeaKind } from '@xc/shared/types';
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
import { captured, HOUR, openTimeline, type Post } from './x-timeline';

let server: TestServer;
let binDir: string;
let context: BrowserContext;

// The fake triage scores a post by its "[score:NN]" marker; the best fresh, non-own post is alice's.
const ALICE: Post = { statusId: '9601', handle: 'alice', text: 'Robinhood Chain wallets keep moving into the LONG eco [score:95]', likes: 400 };
const BOB: Post = { statusId: '9602', handle: 'bob', text: 'Shipping small things every day [score:60]' };
const OWN: Post = { statusId: '9603', handle: 'e2eowner', text: 'my own crypto trading post', likes: 9000 };
const STALE: Post = { statusId: '9604', handle: 'carol', text: 'old crypto token take [score:99]', likes: 9000, ageMs: 48 * HOUR };
const SCORED = [ALICE.statusId, BOB.statusId];

test.beforeAll(async () => {
  context = await launchExtension();
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
  expect((await postJson(server.baseUrl, '/v1/posts', { posts: [ALICE, BOB, OWN, STALE].map(captured) })).ok).toBe(true);
  await expect.poll(triagedIds).toEqual(SCORED);
  await pointExtensionAtServer(context, server.baseUrl);
});

const generateIdea = (body?: object) =>
  fetch(`${server.baseUrl}/v1/ideas/generate`, { method: 'POST', headers: authHeader, body: body ? JSON.stringify(body) : undefined });

async function openIdeasCard(): Promise<{ page: Page; card: ReturnType<Page['getByTestId']> }> {
  const page = await openTimeline(context, [], [], { composer: true });
  await page.getByRole('region', { name: 'Home composer' }).getByRole('button', { name: 'Ideas', exact: true }).click();
  return { page, card: page.getByTestId('compose-ideas-card') };
}

test('a Quote idea shows its source post with an Open post link to it, never quotes a post twice, and says when none is left', async () => {
  const { page, card } = await openIdeasCard();
  const kinds = card.getByRole('group', { name: 'Idea kind' });
  await expect(kinds.getByRole('button')).toHaveText(['Mix', 'Spacehub', 'Eco', 'From timeline', 'Quote']);
  await expect(kinds.getByRole('button', { name: 'Mix' })).toHaveAttribute('aria-pressed', 'true');
  await kinds.getByRole('button', { name: 'Quote' }).click();
  await expect(kinds.getByRole('button', { name: 'Quote' })).toHaveAttribute('aria-pressed', 'true');

  const generate = card.getByRole('button', { name: 'Generate idea' });
  await generate.click();
  const newest = card.getByTestId('compose-idea').first();
  await expect(newest.getByTestId('compose-idea-text')).toHaveText('Fake idea 1');
  await expect(newest.getByTestId('idea-kind')).toHaveText('Quote');
  await expect(newest.getByTestId('idea-source')).toContainText(`@alice: ${ALICE.text}`);
  const link = newest.getByRole('link', { name: 'Open post' });
  await expect(link).toHaveAttribute('href', 'https://x.com/alice/status/9601');
  await expect(link).toHaveAttribute('target', '_blank');
  const opened = context.waitForEvent('page');
  await link.click();
  const tab = await opened;
  await expect.poll(() => tab.url()).toBe('https://x.com/alice/status/9601');
  await tab.close();

  const prompt = readFileSync(join(binDir, 'opencode-digest-prompt.txt'), 'utf8');
  expect(prompt).toContain('these kinds, in this order: ["quote"]');
  // Best first, without the own and the stale post.
  const sources = prompt.slice(prompt.lastIndexOf('<source-posts>\n'));
  expect([...sources.matchAll(/"statusId":"(\d+)"/g)].map((m) => m[1])).toEqual(SCORED);

  await generate.click();
  await expect(newest.getByTestId('compose-idea-text')).toHaveText('Fake idea 2');
  await expect(newest.getByRole('link', { name: 'Open post' })).toHaveAttribute('href', 'https://x.com/bob/status/9602');

  await generate.click();
  await expect(card.getByTestId('compose-ideas-status')).toHaveText('No fresh captured posts to draw from yet');
  await expect(card.getByTestId('compose-idea-text')).toHaveText(['Fake idea 2', 'Fake idea 1']);
  expect(await page.evaluate(() => (window as unknown as { __composer: object }).__composer)).toEqual({ leaked: 0, posted: 0 });
  await page.close();
});

test('Mix never gives spacehub twice in a row, and at most 1 in any 3 ideas', async () => {
  const { page, card } = await openIdeasCard();
  const generate = card.getByRole('button', { name: 'Generate idea' });
  await generate.click();
  await expect(card.getByTestId('idea-kind')).toHaveText(['Spacehub']);
  await generate.click();
  await expect(card.getByTestId('idea-kind')).toHaveText(['Eco', 'Spacehub']);
  await page.close();

  const kinds: IdeaKind[] = ['spacehub', 'eco'];
  for (let i = 0; i < 6; i += 1) {
    const res = await generateIdea();
    expect(res.status).toBe(200);
    kinds.push(((await res.json()) as { idea: { kind: IdeaKind } }).idea.kind);
  }
  expect(new Set(kinds)).toEqual(new Set(['spacehub', 'eco', 'inspired', 'quote']));
  for (let i = 2; i < kinds.length; i += 1) {
    expect(kinds.slice(i - 2, i + 1).filter((k) => k === 'spacehub').length, kinds.join(',')).toBeLessThanOrEqual(1);
  }
  expect((await generateIdea({ kind: 'spacehub' })).status).toBe(200);
  expect(((await (await generateIdea()).json()) as { idea: { kind: string } }).idea.kind).not.toBe('spacehub');
  expect((await generateIdea({ kind: 'nope' })).status).toBe(400);
});

test('a digest keeps at most 1 spacehub idea, and the panel shows each kind with the source line of a From timeline idea', async () => {
  const ideas = [
    { kind: 'spacehub', text: 'Spacehub idea A', feature: 'f' },
    { kind: 'spacehub', text: 'Spacehub idea B', feature: 'f' },
    { kind: 'inspired', text: 'Timeline idea', feature: 'eco', sourceIds: [ALICE.statusId] },
  ];
  writeFileSync(join(binDir, 'digest-ideas.json'), JSON.stringify(ideas));
  expect((await fetch(`${server.baseUrl}/v1/digest/run`, { method: 'POST', headers: authHeader })).status).toBe(200);
  const prompt = readFileSync(join(binDir, 'opencode-digest-prompt.txt'), 'utf8');
  const planned = JSON.parse(/these kinds, in this order: (\[[^\]]*\])/.exec(prompt)?.[1] ?? '[]') as string[];
  expect(planned).toHaveLength(3);
  expect(planned.filter((k) => k === 'spacehub').length).toBeLessThanOrEqual(1);

  const extensionId = await pointExtensionAtServer(context, server.baseUrl);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/panel.html`);
  await panel.getByRole('tab', { name: 'Digest' }).click();
  const rows = panel.getByTestId('digest-idea');
  await expect(rows).toHaveCount(2);
  await expect(rows.getByTestId('idea-kind')).toHaveText(['Spacehub', 'From timeline']);
  await expect(rows.first()).toContainText('Spacehub idea A');
  await expect(rows.first().getByTestId('idea-source')).toHaveCount(0);
  await expect(rows.nth(1).getByTestId('idea-source')).toContainText('@alice:');
  await expect(rows.nth(1).getByRole('link', { name: 'Open post' })).toHaveAttribute('href', 'https://x.com/alice/status/9601');
  await panel.close();
});
