// @covers apps/extension/src/panel/job-progress.ts, apps/extension/src/panel/digest-progress.ts, apps/extension/src/panel/flagged-view.ts, apps/extension/src/panel/flagged-feeds.ts, apps/extension/src/panel/panel.ts, apps/extension/src/panel/panel.css, apps/extension/src/panel/draft-actions.ts, apps/extension/src/content/**, apps/extension/src/background/**, apps/extension/src/drafts/**, apps/extension/src/server-api.ts, apps/server/src/jobs.ts, apps/server/src/router.ts, apps/server/src/app.ts, apps/server/src/digest/**, apps/server/src/polish/**, apps/server/src/llm/**, apps/server/src/triage/retry.ts, apps/server/src/posts.ts, shared/src/types.ts, e2e/fakes/**, e2e/x-timeline.ts
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
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
let context: BrowserContext;
let extensionId: string;

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

// A fresh server per test: quota marks and fake call counters never leak between tests.
test.beforeEach(async () => {
  const fakes = installFakeClis();
  binDir = fakes.binDir;
  const config = {
    handle: 'e2eowner',
    spacehoodRepoPath: makeTempDir('xc-repo-'),
    digest: { everyNPosts: 1000, manualMinIntervalSec: 0 },
    models: { triage: 'google/fake-flash', triageFallbacks: ['google/fake-lite'], final: 'fake-final' },
    triage: { batchSize: 1 },
  };
  server = await startServer(config, { ...fakes.env, GEMINI_API_KEY: 'fake-gemini-key-for-e2e' });
  extensionId = await pointExtensionAtServer(context, server.baseUrl);
});

const fake = (name: string, content: string) => writeFileSync(join(binDir, name), content);
const unfake = (name: string) => rmSync(join(binDir, name), { force: true });

const ideasPill = (page: Page) => page.getByRole('region', { name: 'Home composer' }).getByTestId('toolBar').getByRole('button', { name: 'Ideas', exact: true });

async function openIdeasCard(): Promise<Locator> {
  const page = await openTimeline(context, [], [], { composer: true });
  await ideasPill(page).click();
  return page.getByTestId('compose-ideas-card');
}

/** "<state>: <label>", plus " | <detail>" when the step waits on something. */
const stepTexts = (scope: Locator) =>
  scope.getByTestId('job-step').evaluateAll((items) =>
    items.map((i) => {
      const part = (id: string) => i.querySelector(`[data-testid="${id}"]`)?.textContent;
      const detail = part('step-detail');
      return `${(i as HTMLElement).dataset.state}: ${part('step-label')}${detail ? ` | ${detail}` : ''}`;
    }),
  );

interface ApiPost {
  statusId: string;
  triage: { roughDraft: string | null } | null;
  polish: { status: string; versions: unknown[] } | null;
}

async function apiPost(statusId: string): Promise<ApiPost | undefined> {
  const res = await fetch(`${server.baseUrl}/v1/posts?limit=100`, { headers: authHeader });
  return ((await res.json()) as { posts: ApiPost[] }).posts.find((p) => p.statusId === statusId);
}

async function seedTriaged(post: Post): Promise<void> {
  expect((await postJson(server.baseUrl, '/v1/posts', { posts: [captured(post)] })).ok).toBe(true);
  await expect.poll(async () => (await apiPost(post.statusId))?.triage?.roughDraft ?? null, { timeout: 20_000 }).not.toBeNull();
}

async function jobLabels(jobId: string): Promise<string[]> {
  const res = await fetch(`${server.baseUrl}/v1/jobs?id=${jobId}`, { headers: authHeader });
  return ((await res.json()) as { steps: { label: string }[] }).steps.map((s) => s.label);
}

const GUARD = 'Checking guard (length, product mention, othering)';

test('Generate idea in the compose popover: live steps in order, the quota switch to the fallback model, then Done', async () => {
  const card = await openIdeasCard();
  fake('quota-models.txt', 'google/fake-flash\n');
  fake('digest-mode.txt', 'hold');
  await card.getByRole('button', { name: 'Generate idea' }).click();

  const progress = card.getByTestId('job-progress');
  await expect(progress.getByTestId('job-progress-title')).toHaveText('Generating idea');
  await expect.poll(() => stepTexts(progress)).toEqual([
    'done: Queued',
    'done: Building context (product notes, recent posts and ideas)',
    'current: Asking fake-lite (attempt 1) | Quota reached on fake-flash, switching to fake-lite',
  ]);
  const elapsed = progress.getByTestId('job-progress-elapsed');
  const first = await elapsed.textContent();
  await expect(elapsed).not.toHaveText(first ?? '', { timeout: 5_000 });

  fake('digest-release.txt', 'go');
  await expect(progress.getByTestId('job-progress-title')).toHaveText('Done');
  await expect.poll(() => stepTexts(progress)).toEqual([
    'done: Queued',
    'done: Building context (product notes, recent posts and ideas)',
    'done: Asking fake-lite (attempt 1) | Quota reached on fake-flash, switching to fake-lite',
    'done: Checking the idea',
    'done: Saving the idea',
  ]);
  await expect(card.getByTestId('compose-idea-text').first()).toHaveText('Fake idea 1');
  await card.page().close();
});

test('Generate idea: a high-demand answer shows the retry wait on the model step, then the next attempt', async () => {
  const card = await openIdeasCard();
  fake('digest-busy.txt', '1');
  fake('digest-mode.txt', 'hold');
  await card.getByRole('button', { name: 'Generate idea' }).click();

  const progress = card.getByTestId('job-progress');
  await expect
    .poll(() => stepTexts(progress))
    .toContain('current: Asking fake-flash (attempt 1) | fake-flash under high demand, retrying in 10s');
  await expect.poll(() => stepTexts(progress), { timeout: 20_000 }).toContain('current: Asking fake-flash (attempt 2)');
  fake('digest-release.txt', 'go');
  await expect(card.getByTestId('job-progress-title')).toHaveText('Done');
  await card.page().close();
});

test('Generate idea: a failure shows the reason on the step list with Retry, and Retry runs it again', async () => {
  const card = await openIdeasCard();
  fake('digest-mode.txt', 'fail');
  await card.getByRole('button', { name: 'Generate idea' }).click();

  const title = card.getByTestId('job-progress-title');
  await expect(title).toHaveText('Failed: Idea generation failed: the model CLI failed (see the server log)', { timeout: 20_000 });
  await expect(card.getByTestId('job-step').last()).toHaveAttribute('data-state', 'failed');
  await expect(card.getByRole('button', { name: 'Generate idea' })).toBeEnabled();

  unfake('digest-mode.txt');
  await card.getByTestId('job-retry').click();
  await expect(title).toHaveText('Done');
  await expect(card.getByTestId('compose-idea-text').first()).toHaveText(/^Fake idea \d$/);
  await card.page().close();
});

test('Post idea on a timeline post shows the same live steps', async () => {
  // Not reply-worthy: the post gets + Flag with the "Post idea" sparkle beside it.
  const POST: Post = { statusId: '8601', handle: 'someone', text: 'A timeline post worth an idea [unworthy]' };
  expect((await postJson(server.baseUrl, '/v1/posts', { posts: [captured(POST)] })).ok).toBe(true);
  const page = await openTimeline(context, [POST]);
  fake('digest-mode.txt', 'hold');
  await articleOf(page, POST).getByTestId('inline-post-idea').click({ timeout: 15_000 });
  await page.getByTestId('post-idea-generate').click();

  const progress = page.getByTestId('post-idea').getByTestId('job-progress');
  await expect.poll(() => stepTexts(progress)).toContain('current: Asking fake-flash (attempt 1)');
  fake('digest-release.txt', 'go');
  await expect(progress.getByTestId('job-progress-title')).toHaveText('Done');
  await expect(page.getByTestId('post-idea-result-text')).toHaveText('Fake idea 1');
  await page.close();
});

test('Polish in the Ready popover: steps follow Claude, its retry, the guard and the regenerate after a guard flag', async () => {
  const POST: Post = { statusId: '8701', handle: 'someone', text: 'Flagged post to polish' };
  await seedTriaged(POST);
  fake('claude-calls.txt', '2');
  fake('claude-fail.txt', '1');
  fake('claude-hold.txt', 'hold');
  const page = await openTimeline(context, [POST]);
  await articleOf(page, POST).getByTestId('inline-draft-badge').click({ timeout: 15_000 });
  await page.getByTestId('inline-draft-card').getByTestId('polish-button').click();

  const progress = page.getByTestId('inline-draft-card').getByTestId('job-progress');
  await expect(progress.getByTestId('job-progress-title')).toHaveText('Polishing reply');
  await expect.poll(() => stepTexts(progress)).toEqual(['done: Queued', 'current: Polishing with Claude (fake-final)']);
  unfake('claude-hold.txt');
  await expect.poll(() => stepTexts(progress)).toContain('current: Polishing with Claude (fake-final) | fake-final failed, retrying in 2s');

  await expect(page.getByTestId('inline-draft-text')).toHaveText('lfg #ship #now', { timeout: 20_000 });
  expect(await jobLabels(`polish-${POST.statusId}`)).toEqual([
    'Queued',
    'Polishing with Claude (fake-final, attempt 2)',
    GUARD,
    'Regenerating after guard flag (hashtags, hype-word) with Claude (fake-final)',
    GUARD,
    'Saving the new version',
  ]);
  await page.close();
});

test('Polish failure in the Ready popover shows the reason with Retry; Retry polishes again', async () => {
  const POST: Post = { statusId: '8801', handle: 'someone', text: 'Flagged post whose polish fails' };
  await seedTriaged(POST);
  fake('claude-fail.txt', '3');
  const page = await openTimeline(context, [POST]);
  await articleOf(page, POST).getByTestId('inline-draft-badge').click({ timeout: 15_000 });
  const card = page.getByTestId('inline-draft-card');
  await card.getByTestId('polish-button').click();

  await expect(card.getByTestId('job-progress-title')).toHaveText('Failed: cli failed', { timeout: 20_000 });
  await expect(card.getByTestId('job-step').last()).toHaveAttribute('data-state', 'failed');
  await card.getByTestId('job-retry').click();
  await expect(card.getByTestId('inline-draft-text')).toHaveText(/^Shipping beats polishing/, { timeout: 20_000 });
  await page.close();
});

test('Regenerate on a panel Flagged card shows the live steps until the new version lands', async () => {
  const POST: Post = { statusId: '8901', handle: 'someone', text: 'Flagged post for the panel' };
  await seedTriaged(POST);
  expect((await postJson(server.baseUrl, `/v1/posts/${POST.statusId}/polish`, {})).status).toBe(202);
  await expect.poll(async () => (await apiPost(POST.statusId))?.polish?.status, { timeout: 20_000 }).toBe('ready');

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/panel.html`);
  await panel.getByRole('tab', { name: 'Flagged' }).click();
  const claude = panel.locator(`[data-status-id="${POST.statusId}"]`).getByTestId('claude-version');
  fake('claude-hold.txt', 'hold');
  await claude.getByTestId('draft-regenerate').click({ timeout: 15_000 });

  const progress = claude.getByTestId('job-progress');
  await expect(progress.getByTestId('job-progress-title')).toHaveText('Regenerating reply');
  await expect.poll(() => stepTexts(progress)).toEqual(['done: Queued', 'current: Writing a new version with Claude (fake-final)']);
  unfake('claude-hold.txt');
  await expect(claude.getByTestId('version-label')).toHaveText('2/2', { timeout: 20_000 });
  await expect(claude.getByTestId('job-progress')).toHaveCount(0);
  expect(readFileSync(join(binDir, 'claude-calls.txt'), 'utf8')).toBe('2');
  await panel.close();
});
