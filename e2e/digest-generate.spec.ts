// @covers apps/extension/src/panel/digest-section.ts, apps/extension/src/panel/digest-notice.ts, apps/extension/src/panel/digest-progress.ts, apps/extension/src/panel/voice-tab.ts, apps/extension/src/panel/posts-view.ts, apps/extension/src/panel/panel.css, shared/src/types.ts, apps/extension/src/panel/post-format.ts, apps/extension/src/panel/panel.ts, apps/server/src/triage/retry.ts, apps/server/src/meta.ts, apps/server/src/digest/**, apps/server/src/router.ts, apps/server/src/app.ts, apps/server/src/llm/**, shared/src/config.ts
import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  authHeader,
  fakeTwimg,
  installFakeClis,
  launchExtension,
  pointExtensionAtServer,
  postJson,
  removeTempDirs,
  startServer,
  type TestServer,
} from './harness';

const HOUR = 3_600_000;
let server: TestServer;
let binDir: string;
let context: Awaited<ReturnType<typeof launchExtension>>;

test.beforeAll(async () => {
  context = await launchExtension();
  await fakeTwimg(context);
});

test.afterAll(async () => {
  await context?.close();
  removeTempDirs();
});

test.afterEach(async () => {
  await server?.stop();
});

const capturedPost = (statusId: string) => ({
  statusId,
  authorName: 'N',
  authorHandle: 'someone',
  text: `timeline post ${statusId}`,
  postedAt: new Date(Date.now() - 2 * HOUR).toISOString(),
  metrics: { replies: 2, reposts: 3, likes: 40, views: 900 },
  isReply: false,
  replyTo: [],
  quotedStatusId: null,
});

interface StartOptions {
  everyNPosts?: number;
  fallbacks?: string[];
  /** Triage each post at once (batch of 1) instead of after the 30s flush. */
  triageAtOnce?: boolean;
  /** Runs once the fake CLIs exist, before any post is captured (e.g. to hold the digest). */
  beforePosts?: () => void;
}

async function startWithPosts(postCount: number, manualMinIntervalSec: number, options: StartOptions = {}): Promise<void> {
  const fakes = installFakeClis();
  binDir = fakes.binDir;
  const config = {
    handle: 'e2eowner',
    digest: { everyNPosts: options.everyNPosts ?? 1000, manualMinIntervalSec },
    models: { triage: 'google/fake-flash', triageFallbacks: options.fallbacks ?? [], final: 'fake-final' },
    ...(options.triageAtOnce ? { triage: { batchSize: 1 } } : {}),
  };
  server = await startServer(config, { ...fakes.env, GEMINI_API_KEY: 'fake-gemini-key-for-e2e' });
  options.beforePosts?.();
  const posts = Array.from({ length: postCount }, (_, i) => capturedPost(String(9200 + i)));
  expect((await postJson(server.baseUrl, '/v1/posts', { posts })).ok).toBe(true);
}

async function openDigest(): Promise<Page> {
  const extensionId = await pointExtensionAtServer(context, server.baseUrl);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/panel.html`);
  await panel.getByRole('tab', { name: 'Digest' }).click();
  return panel;
}

const runDigest = () => fetch(`${server.baseUrl}/v1/digest/run`, { method: 'POST', headers: authHeader });
const setDigestMode = (mode: string) => writeFileSync(join(binDir, 'digest-mode.txt'), mode);

test('Generate new ideas: click renders the new ideas; a second run inside the interval is throttled with retry-after', async () => {
  await startWithPosts(3, 60);
  const panel = await openDigest();
  await expect(panel.getByTestId('digest-generate')).toBeVisible();

  await panel.getByTestId('digest-generate').click();
  await expect(panel.getByTestId('digest-idea').first()).toContainText('Fake idea 1');
  await expect(panel.getByTestId('digest-generate')).toBeEnabled();

  await panel.getByTestId('digest-generate').click();
  await expect(panel.getByTestId('digest-generate-error')).toContainText(/try again in \d+s/);
  await expect(panel.getByTestId('digest-generate')).toHaveAttribute('title', /try again in \d+s/);

  const throttled = await runDigest();
  expect(throttled.status).toBe(429);
  expect(Number(throttled.headers.get('retry-after'))).toBeGreaterThan(0);
  expect((await fetch(`${server.baseUrl}/v1/digest/run`, { method: 'POST' })).status).toBe(401);
});

test('Generate new ideas: while a digest is in flight the button is disabled and a second run gets 409', async () => {
  await startWithPosts(3, 0);
  setDigestMode('hold');
  const panel = await openDigest();

  await panel.getByTestId('digest-generate').click();
  await expect(panel.getByTestId('digest-generate')).toBeDisabled();
  await expect(panel.getByTestId('digest-generate')).toHaveText('Generating...');
  await expect.poll(() => existsSync(join(binDir, 'digest-calls.txt'))).toBe(true);
  expect((await runDigest()).status).toBe(409);

  // Regression: leaving the tab and coming back rebuilt the button as idle while the run went on.
  await panel.getByRole('tab', { name: 'Flagged' }).click();
  await panel.getByRole('tab', { name: 'Digest' }).click();
  await expect(panel.getByTestId('digest-generate')).toHaveText('Generating...');
  await expect(panel.getByTestId('digest-generate')).toBeDisabled();

  writeFileSync(join(binDir, 'digest-release.txt'), 'go');
  await expect(panel.getByTestId('digest-idea').first()).toContainText('Fake idea 1');
  await expect(panel.getByTestId('digest-generate')).toBeEnabled();
  expect((await runDigest()).status).toBe(200);
});

test('Generate new ideas: a failed run shows the reason inline and keeps the previous ideas', async () => {
  await startWithPosts(3, 0);
  const panel = await openDigest();
  await panel.getByTestId('digest-generate').click();
  await expect(panel.getByTestId('digest-idea').first()).toContainText('Fake idea 1');

  setDigestMode('fail');
  rmSync(join(binDir, 'digest-release.txt'), { force: true });
  await panel.getByTestId('digest-generate').click();
  await expect(panel.getByTestId('digest-generate-error')).toContainText('Digest generation failed', { timeout: 30_000 });
  await expect(panel.getByTestId('digest-idea').first()).toContainText('Fake idea 1');
  await expect(panel.getByTestId('digest-generate')).toBeEnabled();
});

test('Generate new ideas: too few captured posts gives a clear message', async () => {
  await startWithPosts(1, 0);
  const panel = await openDigest();
  await panel.getByTestId('digest-generate').click();
  await expect(panel.getByTestId('digest-generate-error')).toContainText('Not enough captured posts yet');
  expect(existsSync(join(binDir, 'digest-calls.txt'))).toBe(false);
});

test('Generate new ideas button keeps breathing room below the tab bar', async () => {
  await startWithPosts(3, 0);
  const panel = await openDigest();
  await panel.setViewportSize({ width: 400, height: 800 });
  const button = panel.getByTestId('digest-generate');
  await expect(button).toBeVisible();
  const tabsBottom = (await panel.getByRole('tablist').boundingBox())!.y + (await panel.getByRole('tablist').boundingBox())!.height;
  expect((await button.boundingBox())!.y - tabsBottom).toBeGreaterThanOrEqual(12);
  await panel.screenshot({ path: process.env.DIGEST_SHOT ?? test.info().outputPath('digest-button.png') });
});

test('Generate new ideas: a Gemini quota error frees the button at once, says why inline and in the banner, with the last success', async () => {
  await startWithPosts(3, 0);
  const panel = await openDigest();
  await panel.getByTestId('digest-generate').click();
  await expect(panel.getByTestId('digest-idea').first()).toContainText('Fake idea 1');

  writeFileSync(join(binDir, 'quota-models.txt'), 'google/fake-flash\n');
  await panel.getByTestId('digest-generate').click();
  // Regression: quota errors were retried with 60s sleeps, leaving the button on "Generating..." for minutes.
  await expect(panel.getByTestId('digest-generate-error')).toContainText('Gemini free quota reached');
  await expect(panel.getByTestId('digest-generate-error')).toContainText('resumes at');
  await expect(panel.getByTestId('digest-generate')).toBeEnabled();
  await expect(panel.getByTestId('digest-generate')).toHaveText('Generate new ideas');

  const banner = panel.getByTestId('digest-failed');
  await expect(banner).toContainText('Last refresh failed: Gemini free quota reached');
  await expect(banner).toContainText(/resumes at \d{1,2}:\d{2} [AP]M/);
  await expect(banner).toContainText(/Showing the previous digest from \d{1,2}:\d{2} [AP]M/);
  await expect(panel.getByTestId('digest-idea').first()).toContainText('Fake idea 1');

  const paused = await runDigest();
  expect(paused.status).toBe(503);
  expect(await paused.json()).toMatchObject({ resumesAt: expect.any(Number) });
  const calls = readFileSync(join(binDir, 'opencode-calls.txt'), 'utf8').split('\n').filter((l) => l.endsWith(' digest'));
  expect(calls).toEqual(['google/fake-flash digest', 'google/fake-flash digest']);
});

async function allTriaged(): Promise<boolean> {
  const body = (await (await fetch(`${server.baseUrl}/v1/posts?limit=100`, { headers: authHeader })).json()) as { posts: { triage: unknown }[] };
  return body.posts.length > 0 && body.posts.every((p) => p.triage !== null);
}

const stepStates = (panel: Page) =>
  panel.getByTestId('digest-step').evaluateAll((items) => items.map((i) => (i as HTMLElement).dataset.state ?? ''));

test('Generate new ideas: a step list follows the run (posts, context, model with quota switch), then shows Done and hides', async () => {
  await startWithPosts(3, 0, { fallbacks: ['google/fake-lite'], triageAtOnce: true });
  await expect.poll(allTriaged).toBe(true);
  setDigestMode('hold');
  writeFileSync(join(binDir, 'quota-models.txt'), 'google/fake-flash\n');
  const panel = await openDigest();
  await panel.setViewportSize({ width: 400, height: 800 });
  const progress = panel.getByTestId('digest-progress');
  await expect(progress).toBeHidden();

  await panel.getByTestId('digest-generate').click();
  const steps = panel.getByTestId('digest-step');
  await expect(progress).toBeVisible();
  await expect.poll(() => stepStates(panel)).toEqual(['done', 'done', 'current', 'pending']);
  await expect(steps.nth(0)).toContainText('Collecting recent posts (3)');
  await expect(steps.nth(1)).toContainText('Reading Spacehub context (announcements, README, commits)');
  await expect(steps.nth(2)).toContainText('Asking fake-lite (attempt 1)');
  await expect(steps.nth(2)).toContainText('Quota reached on fake-flash, switching to fake-lite');
  await expect(steps.nth(3)).toContainText('Saving ideas');
  await expect(panel.getByTestId('digest-progress-title')).toHaveText('Generating ideas');

  const elapsed = panel.getByTestId('digest-progress-elapsed');
  const firstElapsed = await elapsed.textContent();
  await expect(elapsed).not.toHaveText(firstElapsed ?? '', { timeout: 10_000 });
  expect(await panel.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await panel.screenshot({ path: process.env.DIGEST_PROGRESS_SHOT ?? test.info().outputPath('digest-progress.png') });

  writeFileSync(join(binDir, 'digest-release.txt'), 'go');
  await expect(panel.getByTestId('digest-progress-title')).toHaveText('Done — 1 idea');
  await expect.poll(() => stepStates(panel)).toEqual(['done', 'done', 'done', 'done']);
  await expect(panel.getByTestId('digest-idea').first()).toContainText('Fake idea 1');
  await expect(progress).toBeHidden({ timeout: 15_000 });
});

test('Generate new ideas: an automatic digest run shows the same steps without a click', async () => {
  await startWithPosts(3, 0, { everyNPosts: 3, beforePosts: () => setDigestMode('hold') });
  const panel = await openDigest();
  await expect(panel.getByTestId('digest-progress')).toBeVisible();
  await expect(panel.getByTestId('digest-step').nth(2)).toContainText('Asking fake-flash (attempt 1)');
  await expect(panel.getByTestId('digest-generate')).toBeDisabled();

  writeFileSync(join(binDir, 'digest-release.txt'), 'go');
  await expect(panel.getByTestId('digest-progress-title')).toHaveText('Done — 1 idea');
  await expect(panel.getByTestId('digest-progress')).toBeHidden({ timeout: 15_000 });
});

test('Generate new ideas: a failed run shows the failure reason in the step list', async () => {
  await startWithPosts(3, 0, { triageAtOnce: true });
  await expect.poll(allTriaged).toBe(true);
  writeFileSync(join(binDir, 'quota-models.txt'), 'google/fake-flash\n');
  const panel = await openDigest();
  await panel.getByTestId('digest-generate').click();
  await expect(panel.getByTestId('digest-progress-title')).toHaveText('Failed: Gemini free quota reached on every configured model');
  await expect.poll(() => stepStates(panel)).toEqual(['done', 'done', 'failed', 'pending']);
  await expect(panel.getByTestId('digest-step').nth(2)).toContainText('Quota reached on fake-flash, no model left');
  await expect(panel.getByTestId('digest-progress')).toBeHidden({ timeout: 15_000 });
});

test('Generate new ideas: new ideas replace the shown ones without a reload, for manual and automatic runs', async () => {
  await startWithPosts(3, 0, { everyNPosts: 4 });
  const panel = await openDigest();
  await panel.getByTestId('digest-generate').click();
  await expect(panel.getByTestId('digest-idea').first()).toContainText('Fake idea 1');
  await expect(panel.getByTestId('digest-generate')).toBeEnabled();

  await panel.getByTestId('digest-generate').click();
  await expect(panel.getByTestId('digest-progress-title')).toHaveText('Done — 1 idea');
  await expect(panel.getByTestId('digest-idea').first()).toContainText('Fake idea 2');
  await expect(panel.getByTestId('digest-generated')).toHaveText(/^Generated \d{1,2}:\d{2} [AP]M/);
  // Regression: the model re-suggested the same topics because earlier ideas never reached the prompt.
  expect(readFileSync(join(binDir, 'opencode-digest-prompt.txt'), 'utf8')).toMatch(/<previous-ideas>[^]*Fake idea 1[^]*<\/previous-ideas>/);

  const posts = [capturedPost('9300')];
  expect((await postJson(server.baseUrl, '/v1/posts', { posts })).ok).toBe(true);
  await expect(panel.getByTestId('digest-idea').first()).toContainText('Fake idea 3');
});

test('Digest: Show earlier ideas reveals ideas from earlier digests, newest first, each with its generated time and actions', async () => {
  await startWithPosts(3, 0);
  const panel = await openDigest();
  const ideas = panel.getByTestId('digest-idea');
  await expect(panel.getByTestId('digest-show-more')).toHaveCount(0);

  await panel.getByTestId('digest-generate').click();
  await expect(ideas.first()).toContainText('Fake idea 1');
  await expect(panel.getByTestId('digest-generate')).toBeEnabled();
  await panel.getByTestId('digest-generate').click();
  await expect(ideas.first()).toContainText('Fake idea 2');
  await expect(panel.getByTestId('digest-generate')).toBeEnabled();
  await panel.getByTestId('digest-generate').click();
  await expect(ideas.first()).toContainText('Fake idea 3');
  await expect(ideas).toHaveCount(1);

  const showMore = panel.getByTestId('digest-show-more');
  await expect(showMore).toHaveText('Show earlier ideas (2)');
  await showMore.click();
  await expect(ideas).toHaveCount(3);
  await expect(ideas.nth(1)).toContainText('Fake idea 2');
  await expect(ideas.nth(2)).toContainText('Fake idea 1');
  await expect(panel.getByTestId('digest-earlier-generated')).toHaveCount(2);
  await expect(panel.getByTestId('digest-earlier-generated').first()).toHaveText(/^Generated \d{1,2}:\d{2} [AP]M/);
  await expect(ideas.nth(1).getByTestId('idea-polish')).toBeVisible();

  // Stays open across polls, and a newer digest pushes the old latest into the earlier list.
  await expect(showMore).toHaveText('Hide earlier ideas');
  await panel.getByTestId('digest-generate').click();
  await expect(ideas.first()).toContainText('Fake idea 4');
  await expect(ideas).toHaveCount(4);
  await showMore.click();
  await expect(ideas).toHaveCount(1);
  await expect(showMore).toHaveText('Show earlier ideas (3)');
  const view = (await (await fetch(`${server.baseUrl}/v1/digest`, { headers: authHeader })).json()) as { earlier: unknown[] };
  expect(view.earlier).toHaveLength(3);
});
