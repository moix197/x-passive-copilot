// @covers apps/extension/src/panel/digest-section.ts, apps/extension/src/panel/panel.ts, apps/server/src/digest/**, apps/server/src/router.ts, apps/server/src/app.ts, apps/server/src/llm/**, shared/src/config.ts
import { expect, test, type Page } from '@playwright/test';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
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

async function startWithPosts(postCount: number, manualMinIntervalSec: number): Promise<void> {
  const fakes = installFakeClis();
  binDir = fakes.binDir;
  const config = {
    handle: 'e2eowner',
    digest: { everyNPosts: 1000, manualMinIntervalSec },
    models: { triage: 'google/fake-flash', final: 'fake-final' },
  };
  server = await startServer(config, { ...fakes.env, GEMINI_API_KEY: 'fake-gemini-key-for-e2e' });
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
