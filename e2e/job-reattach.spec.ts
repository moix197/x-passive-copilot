// @covers apps/server/src/jobs.ts, apps/server/src/router.ts, apps/server/src/app.ts, apps/server/src/digest/**, apps/server/src/polish/polish.ts, apps/extension/src/panel/activity-tab.ts, apps/extension/src/panel/job-retry.ts, apps/extension/src/panel/job-progress.ts, apps/extension/src/panel/digest-progress.ts, apps/extension/src/panel/panel.ts, apps/extension/src/panel/panel.html, apps/extension/src/panel/panel.css, apps/extension/src/panel/posts-view.ts, apps/extension/src/panel/draft-actions.ts, apps/extension/src/panel/x-tab.ts, apps/extension/src/content/**, apps/extension/src/background/**, apps/extension/src/server-api.ts, shared/src/types.ts, e2e/fakes/**, e2e/x-timeline.ts
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
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
import { articleOf, captured, openTimeline, type Post } from './x-timeline';

let server: TestServer;
let binDir: string;
let serverEnv: NodeJS.ProcessEnv;
let context: BrowserContext;
let extensionId: string;

const config = {
  handle: 'e2eowner',
  spacehoodRepoPath: makeTempDir('xc-repo-'),
  digest: { everyNPosts: 1000, manualMinIntervalSec: 0 },
  models: { triage: 'google/fake-flash', triageFallbacks: ['google/fake-lite'], final: 'fake-final' },
  triage: { batchSize: 1 },
};

test.beforeAll(async () => {
  context = await launchExtension();
  await fakeTwimg(context);
});

test.afterAll(async () => {
  await context?.close();
  removeTempDirs();
});

test.afterEach(async () => {
  // Lets any held fake model call end, so no generation outlives its test.
  writeFileSync(join(binDir, 'digest-release.txt'), 'go');
  await server?.stop();
});

test.beforeEach(async () => {
  const fakes = installFakeClis();
  binDir = fakes.binDir;
  serverEnv = { ...fakes.env, GEMINI_API_KEY: 'fake-gemini-key-for-e2e' };
  server = await startServer(config, serverEnv);
  extensionId = await pointExtensionAtServer(context, server.baseUrl);
});

const fake = (name: string, content: string) => writeFileSync(join(binDir, name), content);
const unfake = (name: string) => rmSync(join(binDir, name), { force: true });

// Not reply-worthy: each post gets + Flag with the "Post idea" sparkle beside it.
const postOf = (statusId: string, text: string): Post => ({ statusId, handle: 'someone', text: `${text} [unworthy]` });

async function capture(...posts: Post[]): Promise<void> {
  expect((await postJson(server.baseUrl, '/v1/posts', { posts: posts.map(captured) })).ok).toBe(true);
}

const ideaRequest = (post: Post) => ({ kind: 'inspired', source: { statusId: post.statusId, authorHandle: post.handle, text: post.text } });

interface ListedJob {
  id: string;
  kind: string;
  key: string;
  outcome: { ok: boolean } | null;
  result: { type: string } | null;
}

async function listJobs(): Promise<ListedJob[]> {
  const res = await fetch(`${server.baseUrl}/v1/jobs`, { headers: authHeader });
  return ((await res.json()) as { jobs: ListedJob[] }).jobs;
}

// Posts triaged reply-worthy, whose Ready pill offers Polish.
async function listPolishable(): Promise<string[]> {
  const res = await fetch(`${server.baseUrl}/v1/posts?limit=100`, { headers: authHeader });
  const { posts } = (await res.json()) as { posts: { statusId: string; triage: { roughDraft: string | null } | null }[] };
  return posts.filter((p) => p.triage?.roughDraft).map((p) => p.statusId);
}

const runningKeys = async () => (await listJobs()).filter((j) => !j.outcome).map((j) => j.key).sort();

const stepTexts = (scope: Locator) =>
  scope.getByTestId('job-step').evaluateAll((items) =>
    items.map((i) => `${(i as HTMLElement).dataset.state}: ${i.querySelector('[data-testid="step-label"]')?.textContent}`),
  );

async function openPostIdea(page: Page, post: Post): Promise<Locator> {
  await articleOf(page, post).getByTestId('inline-post-idea').click({ timeout: 15_000 });
  return page.getByTestId('post-idea');
}

async function startPostIdea(page: Page, post: Post): Promise<{ section: Locator; jobId: string }> {
  const section = await openPostIdea(page, post);
  await section.getByTestId('post-idea-generate').click();
  const progress = section.getByTestId('job-progress');
  await expect.poll(() => stepTexts(progress)).toContain('current: Asking fake-flash (attempt 1)');
  return { section, jobId: (await progress.getAttribute('data-job-id')) ?? '' };
}

async function openActivity(): Promise<Page> {
  const panel = await context.newPage();
  // Headless Chromium grants no clipboard to extension pages: Copy lands in a list the test reads.
  await panel.addInitScript(() => {
    const copied: string[] = [];
    Object.assign(window, { __copied: copied });
    navigator.clipboard.writeText = async (text: string) => void copied.push(text);
  });
  await panel.goto(`chrome-extension://${extensionId}/panel.html`);
  await panel.getByRole('tab', { name: 'Activity' }).click();
  return panel;
}

const activityJob = (panel: Page, section: 'activity-running' | 'activity-recent') => panel.getByTestId(section).getByTestId('activity-job');

test('Post idea survives a reload: the popover shows the same job still running, a second request attaches to it, then the idea shows', async () => {
  const POST = postOf('9101', 'A post whose idea outlives a reload');
  await capture(POST);
  fake('digest-mode.txt', 'hold');
  const page = await openTimeline(context, [POST]);
  const { jobId } = await startPostIdea(page, POST);
  expect(jobId).toMatch(/^idea-/);

  await page.reload();
  const section = await openPostIdea(page, POST);
  const progress = section.getByTestId('job-progress');
  await expect(progress).toHaveAttribute('data-job-id', jobId);
  await expect.poll(() => stepTexts(progress)).toContain('current: Asking fake-flash (attempt 1)');
  await expect(section.getByTestId('post-idea-generate')).toBeDisabled();

  // Asking again for the same post (another tab, a click before the popover attached) gets the running job, not an error.
  const again = await postJson(server.baseUrl, '/v1/ideas/generate', ideaRequest(POST));
  expect(again.status).toBe(202);
  expect(((await again.json()) as { job: { id: string } }).job.id).toBe(jobId);

  fake('digest-release.txt', 'go');
  await expect(progress.getByTestId('job-progress-title')).toHaveText('Done');
  await expect(section.getByTestId('post-idea-result-text')).toHaveText('Fake idea 1');
  await expect(section.getByTestId('post-idea-status')).toHaveText('');
  await page.close();
});

test('Post idea that finished while the page was gone shows its idea when the popover opens', async () => {
  const POST = postOf('9201', 'A post whose idea lands while away');
  await capture(POST);
  fake('digest-mode.txt', 'hold');
  const page = await openTimeline(context, [POST]);
  await startPostIdea(page, POST);
  await page.close();

  fake('digest-release.txt', 'go');
  await expect.poll(async () => (await listJobs()).find((j) => j.key === 'post-idea:9201')?.outcome?.ok).toBe(true);
  const back = await openTimeline(context, [POST]);
  const section = await openPostIdea(back, POST);
  await expect(section.getByTestId('post-idea-result-text')).toHaveText('Fake idea 1');
  await back.close();
});

test('Two posts generate their ideas side by side: the lock is per post, both show as running in Activity with a badge of 2', async () => {
  const A = postOf('9301', 'First post of two');
  const B = postOf('9302', 'Second post of two');
  await capture(A, B);
  fake('digest-mode.txt', 'hold');
  const replies = [A, B].map((post) => postJson(server.baseUrl, '/v1/ideas/generate', ideaRequest(post)));
  await expect.poll(runningKeys).toEqual(['post-idea:9301', 'post-idea:9302']);

  const panel = await openActivity();
  await expect(activityJob(panel, 'activity-running')).toHaveCount(2);
  await expect(panel.getByTestId('activity-badge')).toHaveText('2');
  await expect(activityJob(panel, 'activity-running').getByTestId('activity-job-label')).toHaveText([
    'Post idea · @someone: Second post of two [unworthy]',
    'Post idea · @someone: First post of two [unworthy]',
  ]);

  fake('digest-release.txt', 'go');
  expect((await Promise.all(replies)).map((r) => r.status)).toEqual([200, 200]);
  await expect(activityJob(panel, 'activity-recent')).toHaveCount(2);
  await expect(panel.getByTestId('activity-badge')).toBeHidden();
  await panel.close();
});

test('Activity lists the running job with live steps, then the done one with its idea, Copy and Open post', async () => {
  const POST = postOf('9401', 'A post for the Activity tab');
  await capture(POST);
  fake('digest-mode.txt', 'hold');
  const reply = postJson(server.baseUrl, '/v1/ideas/generate', ideaRequest(POST));

  const panel = await openActivity();
  const running = activityJob(panel, 'activity-running');
  await expect(running).toHaveCount(1);
  await expect(running.getByTestId('job-progress-title')).toHaveText('Generating idea');
  await expect.poll(() => stepTexts(running)).toContain('current: Asking fake-flash (attempt 1)');
  await expect(panel.getByTestId('activity-badge')).toHaveText('1');

  fake('digest-release.txt', 'go');
  expect((await reply).status).toBe(200);
  const done = activityJob(panel, 'activity-recent');
  await expect(done).toHaveAttribute('data-state', 'done');
  await expect(running).toHaveCount(0);
  await expect(done.getByTestId('job-progress-title')).toHaveText('Done');
  await expect(done.getByTestId('activity-job-result')).toHaveText('Fake idea 1');
  await done.getByRole('button', { name: 'Copy' }).click();
  await expect.poll(() => panel.evaluate(() => (window as unknown as { __copied: string[] }).__copied)).toEqual(['Fake idea 1']);

  await done.getByTestId('activity-open-post').click();
  const worker = context.serviceWorkers()[0]!;
  const tabUrls = () => worker.evaluate(async () => (await chrome.tabs.query({})).map((t) => t.pendingUrl ?? t.url ?? ''));
  await expect.poll(tabUrls).toContain('https://x.com/someone/status/9401');
  await panel.close();
});

test('A failed job shows its reason with Retry in Activity, and Retry runs it again', async () => {
  fake('digest-mode.txt', 'fail');
  expect((await postJson(server.baseUrl, '/v1/ideas/generate', {})).status).toBe(502);

  const panel = await openActivity();
  const failed = activityJob(panel, 'activity-recent');
  await expect(failed).toHaveAttribute('data-state', 'failed');
  await expect(failed.getByTestId('activity-job-label')).toHaveText('Compose idea');
  await expect(failed.getByTestId('job-progress-title')).toHaveText('Failed: Idea generation failed: the model CLI failed (see the server log)');

  fake('digest-mode.txt', 'hold');
  await failed.getByTestId('job-retry').click();
  await expect(activityJob(panel, 'activity-running')).toHaveCount(1);
  fake('digest-release.txt', 'go');
  await expect(activityJob(panel, 'activity-recent').first()).toHaveAttribute('data-state', 'done');
  await expect(activityJob(panel, 'activity-recent').first().getByTestId('activity-job-result')).toHaveText(/^Fake idea \d$/);
  await expect(activityJob(panel, 'activity-recent')).toHaveCount(2);
  await panel.close();
});

test('A server restart during a Post idea shows the job as failed: server restarted', async () => {
  const POST = postOf('9501', 'A post whose server restarts');
  await capture(POST);
  fake('digest-mode.txt', 'hold');
  const page = await openTimeline(context, [POST]);
  const { section } = await startPostIdea(page, POST);

  await server.stop();
  server = await startServer(config, serverEnv, server.home);
  await pointExtensionAtServer(context, server.baseUrl);
  await expect(section.getByTestId('job-progress-title')).toHaveText('Failed: server restarted');
  await expect(section.getByTestId('job-retry')).toBeVisible();
  await page.close();
});

test('Polish survives a reload: the Ready popover shows the same running job, a second request gets it, and Activity lists the new draft', async () => {
  const POST: Post = { statusId: '9601', handle: 'someone', text: 'Flagged post polished across a reload' };
  await capture(POST);
  await expect.poll(async () => (await listPolishable()).includes(POST.statusId), { timeout: 20_000 }).toBe(true);
  fake('claude-hold.txt', 'hold');
  const page = await openTimeline(context, [POST]);
  await articleOf(page, POST).getByTestId('inline-draft-badge').click({ timeout: 15_000 });
  await page.getByTestId('inline-draft-card').getByTestId('polish-button').click();
  const steps = () => stepTexts(page.getByTestId('inline-draft-card').getByTestId('job-progress'));
  await expect.poll(steps).toEqual(['done: Queued', 'current: Polishing with Claude (fake-final)']);

  await page.reload();
  await articleOf(page, POST).getByTestId('inline-draft-badge').click({ timeout: 15_000 });
  const progress = page.getByTestId('inline-draft-card').getByTestId('job-progress');
  await expect(progress).toHaveAttribute('data-job-id', 'polish-9601');
  await expect.poll(steps).toEqual(['done: Queued', 'current: Polishing with Claude (fake-final)']);
  const again = await postJson(server.baseUrl, '/v1/posts/9601/polish', {});
  expect(again.status).toBe(202);
  expect(await again.json()).toMatchObject({ state: 'already', job: { id: 'polish-9601', kind: 'polish', outcome: null } });

  unfake('claude-hold.txt');
  await expect(page.getByTestId('inline-draft-text')).toHaveText(/^Shipping beats polishing/, { timeout: 20_000 });
  const panel = await openActivity();
  const done = activityJob(panel, 'activity-recent').filter({ hasText: 'Polish · @someone' });
  await expect(done).toHaveAttribute('data-state', 'done');
  await expect(done.getByTestId('activity-job-result')).toHaveText(/^Shipping beats polishing/);
  await panel.close();
  await page.close();
});
