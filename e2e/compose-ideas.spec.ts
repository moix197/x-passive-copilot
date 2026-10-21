// @covers apps/extension/src/content/**, apps/extension/src/background/**, apps/extension/src/drafts/idea-list.ts, apps/extension/src/server-api.ts, apps/extension/src/server-config.ts, apps/extension/src/panel/draft-actions.ts, apps/extension/src/panel/dom.ts, apps/extension/src/panel/panel.css, apps/extension/src/panel/post-format.ts, apps/extension/manifest.json, scripts/build.mjs, apps/server/src/digest/**, apps/server/src/router.ts, apps/server/src/app.ts, apps/server/src/llm/**, apps/server/src/triage/retry.ts, shared/src/types.ts, e2e/x-timeline.ts, e2e/fakes/**
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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
import { captured, openTimeline } from './x-timeline';

let server: TestServer;
let binDir: string;
let context: BrowserContext;

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

// A fresh server with 3 captured posts and one digest ("Fake idea 1"), so the popover has an idea on open.
test.beforeEach(async () => {
  const fakes = installFakeClis();
  binDir = fakes.binDir;
  const config = {
    handle: 'e2eowner',
    spacehoodRepoPath: makeTempDir('xc-repo-'),
    digest: { everyNPosts: 1000, manualMinIntervalSec: 0 },
    models: { triage: 'google/fake-flash', triageFallbacks: [], final: 'fake-final' },
  };
  server = await startServer(config, { ...fakes.env, GEMINI_API_KEY: 'fake-gemini-key-for-e2e' });
  const posts = ['9501', '9502', '9503'].map((statusId) => captured({ statusId, handle: 'someone', text: `timeline post ${statusId}` }));
  expect((await postJson(server.baseUrl, '/v1/posts', { posts })).ok).toBe(true);
  expect((await fetch(`${server.baseUrl}/v1/digest/run`, { method: 'POST', headers: authHeader })).status).toBe(200);
  await pointExtensionAtServer(context, server.baseUrl);
});

const generateIdea = () => fetch(`${server.baseUrl}/v1/ideas/generate`, { method: 'POST', headers: authHeader });
const openComposer = () => openTimeline(context, [], [], { composer: true });
const composer = (page: Page, name: string) => page.getByRole('region', { name });
const ideasPill = (scope: Locator) => scope.getByTestId('toolBar').getByRole('button', { name: 'Ideas', exact: true });
const composerHits = (page: Page) => page.evaluate(() => (window as unknown as { __composer: object }).__composer);

interface DigestBody {
  digest: { trends: { title: string }[]; ideas: { text: string }[] } | null;
  earlier: { ideas: { text: string }[] }[];
}

test('an Ideas pill sits in the compose toolbar; its popover lists recent ideas, Generate adds distinct ones, Copy copies, and nothing reaches X', async () => {
  const page = await openComposer();
  const home = composer(page, 'Home composer');
  const pill = ideasPill(home);
  await expect(pill).toHaveCount(1);
  await expect(pill).toHaveText('Ideas');
  await expect(pill).toHaveAttribute('aria-expanded', 'false');

  await pill.click();
  const card = page.getByTestId('compose-ideas-card');
  const ideas = card.getByTestId('compose-idea-text');
  await expect(pill).toHaveAttribute('aria-expanded', 'true');
  await expect(ideas.first()).toHaveText('Fake idea 1');

  const generate = card.getByRole('button', { name: 'Generate idea' });
  writeFileSync(join(binDir, 'digest-mode.txt'), 'hold');
  await generate.click();
  await expect(card.getByTestId('compose-idea-generate')).toHaveText('Generating…');
  await expect(card.getByTestId('compose-idea-generate')).toBeDisabled();
  await expect.poll(() => readFileSync(join(binDir, 'digest-calls.txt'), 'utf8')).toBe('2');
  writeFileSync(join(binDir, 'digest-release.txt'), 'go');
  await expect(ideas.first()).toHaveText('Fake idea 2');
  await expect(generate).toBeEnabled();

  await generate.click();
  await expect(ideas.first()).toHaveText('Fake idea 3');
  await expect(ideas).toHaveText(['Fake idea 3', 'Fake idea 2', 'Fake idea 1']);
  // The single-idea prompt is the digest's, with earlier ideas so the next one differs.
  const prompt = readFileSync(join(binDir, 'opencode-digest-prompt.txt'), 'utf8');
  expect(prompt).toMatch(/<previous-ideas>[^]*Fake idea 2[^]*Fake idea 1[^]*<\/previous-ideas>/);
  expect(prompt).toContain('(exactly 1 idea)');
  expect(prompt).toContain('Post ideas are build-in-public and educational, never promotional.');

  await card.getByTestId('compose-idea').first().getByRole('button', { name: 'Copy' }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('Fake idea 3');

  await pill.press('a');
  await pill.click();
  await expect(card).toHaveCount(0);
  expect(await composerHits(page)).toEqual({ leaked: 0, posted: 0 });
  await expect(home.getByRole('textbox', { name: 'Post text' })).toHaveText('Half-written post');

  // The panel's Digest tab reads the same store: newest idea first, the last digest's trends kept.
  const view = (await (await fetch(`${server.baseUrl}/v1/digest`, { headers: authHeader })).json()) as DigestBody;
  expect(view.digest?.ideas.map((i) => i.text)).toEqual(['Fake idea 3']);
  expect(view.digest?.trends.map((t) => t.title)).toEqual(['Fake trend']);
  expect(view.earlier.flatMap((d) => d.ideas.map((i) => i.text))).toEqual(['Fake idea 2', 'Fake idea 1']);
  await page.close();
});

test('the Post modal composer gets its own pill, and a re-rendered toolbar gets the pill back once, keeping the open popover', async () => {
  const page = await openComposer();
  await page.evaluate(() => (window as unknown as { __openPostModal: () => void }).__openPostModal());
  const modal = composer(page, 'Post modal composer');
  await expect(ideasPill(modal)).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Ideas', exact: true })).toHaveCount(2);

  const home = composer(page, 'Home composer');
  await ideasPill(home).click();
  await expect(page.getByTestId('compose-idea-text').first()).toHaveText('Fake idea 1');
  await page.evaluate(() => (window as unknown as { __rerenderToolbar: (i: number) => void }).__rerenderToolbar(0));
  await expect(ideasPill(home)).toHaveCount(1);
  await expect(ideasPill(home)).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('compose-ideas-card')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ideas', exact: true })).toHaveCount(2);

  await ideasPill(modal).click();
  await expect(ideasPill(modal)).toHaveAttribute('aria-expanded', 'true');
  await expect(ideasPill(home)).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('compose-idea-text').first()).toHaveText('Fake idea 1');
  expect(await composerHits(page)).toEqual({ leaked: 0, posted: 0 });
  await page.close();
});

test('a quota pause on every model shows when generating resumes, and keeps the listed ideas', async () => {
  const page = await openComposer();
  await ideasPill(composer(page, 'Home composer')).click();
  const card = page.getByTestId('compose-ideas-card');
  await expect(card.getByTestId('compose-idea-text').first()).toHaveText('Fake idea 1');

  writeFileSync(join(binDir, 'quota-models.txt'), 'google/fake-flash\n');
  await card.getByRole('button', { name: 'Generate idea' }).click();
  await expect(card.getByTestId('compose-ideas-status')).toHaveText(/^Paused · resumes \d{1,2}:\d{2} [AP]M/);
  await expect(card.getByTestId('compose-idea-text')).toHaveText(['Fake idea 1']);
  await expect(card.getByRole('button', { name: 'Generate idea' })).toBeEnabled();
  await page.close();
});

test('POST /v1/ideas/generate: auth required, one new saved idea per call, 409 while one runs, 503 with resumesAt when paused', async () => {
  expect((await fetch(`${server.baseUrl}/v1/ideas/generate`, { method: 'POST' })).status).toBe(401);

  const first = await generateIdea();
  expect(first.status).toBe(200);
  const { idea } = (await first.json()) as { idea: { id: string; text: string; polish: unknown } };
  expect(idea).toMatchObject({ id: expect.stringMatching(/^\d+-0$/), text: 'Fake idea 2', polish: null });

  writeFileSync(join(binDir, 'digest-mode.txt'), 'hold');
  const held = generateIdea();
  await expect.poll(() => existsSync(join(binDir, 'digest-calls.txt')) && readFileSync(join(binDir, 'digest-calls.txt'), 'utf8')).toBe('3');
  expect((await generateIdea()).status).toBe(409);
  writeFileSync(join(binDir, 'digest-release.txt'), 'go');
  expect(((await (await held).json()) as { idea: { text: string } }).idea.text).toBe('Fake idea 3');

  writeFileSync(join(binDir, 'quota-models.txt'), 'google/fake-flash\n');
  const quota = await generateIdea();
  expect(quota.status).toBe(502);
  expect(await quota.json()).toMatchObject({ error: expect.stringContaining('Idea generation failed'), resumesAt: expect.any(Number) });
  const paused = await generateIdea();
  expect(paused.status).toBe(503);
  expect(await paused.json()).toMatchObject({ resumesAt: expect.any(Number) });
});
