// @covers apps/extension/src/content/**, apps/extension/src/background/**, apps/extension/src/drafts/**, apps/extension/src/server-api.ts, apps/extension/src/panel/flagged-view.ts, apps/extension/src/panel/flagged-feeds.ts, apps/extension/src/panel/post-format.ts, apps/server/src/posts.ts, apps/server/src/router.ts, apps/server/src/app.ts, apps/server/src/db.ts, apps/server/src/triage/**, apps/server/src/llm/**, shared/src/types.ts, e2e/fakes/**, e2e/x-timeline.ts
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
import { articleOf, captured, HOUR, openTimeline, type Post } from './x-timeline';

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
test.afterEach(() => {
  rmSync(holdFile(), { force: true });
  rmSync(join(binDir, 'quota-models.txt'), { force: true });
});

const post = (statusId: string, text: string, extra: Partial<Post> = {}): Post => ({ statusId, handle: 'someone', text, ...extra });
/** Three days old with no likes: the prefilter skips it, so only a manual flag brings it to To reply. */
const skippedPost = (statusId: string, text: string) => post(statusId, text, { ageMs: 72 * HOUR, likes: 0 });

interface ApiTriage {
  score: number | null;
  roughDraft: string | null;
  skipReason: string | null;
  mustFlag: string | null;
}
interface ApiPost {
  statusId: string;
  manualFlaggedAt: number | null;
  triage: ApiTriage | null;
}

async function apiPost(statusId: string): Promise<ApiPost | undefined> {
  const res = await fetch(`${server.baseUrl}/v1/posts?limit=200`, { headers: authHeader });
  return ((await res.json()) as { posts: ApiPost[] }).posts.find((p) => p.statusId === statusId);
}

async function ingestTriaged(...posts: Post[]): Promise<void> {
  expect((await postJson(server.baseUrl, '/v1/posts', { posts: posts.map(captured) })).ok).toBe(true);
  for (const p of posts) {
    await expect.poll(async () => (await apiPost(p.statusId))?.triage ?? null, { timeout: 20_000 }).not.toBeNull();
  }
}

async function toReplyIds(): Promise<string[]> {
  const res = await fetch(`${server.baseUrl}/v1/posts?view=flagged&feed=to_reply&limit=200`, { headers: authHeader });
  return ((await res.json()) as { posts: { statusId: string }[] }).posts.map((p) => p.statusId);
}

const flag = (statusId: string, headers: Record<string, string> = authHeader) =>
  fetch(`${server.baseUrl}/v1/posts/${statusId}/flag`, { method: 'POST', headers });

async function openFlagged(): Promise<Page> {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/panel.html`);
  await panel.getByRole('tab', { name: 'Flagged' }).click();
  return panel;
}

test('only Flagged posts get Ready: an unflagged post with a draft gets + Flag, a replied one a muted Replied', async () => {
  const FLAGGED = post('7101', 'Flagged post about shipping');
  const DRAFTED = post('7102', 'Unflagged post the model drafted anyway [draft-anyway]');
  const REPLIED = post('7103', 'Flagged post already replied');
  await ingestTriaged(FLAGGED, DRAFTED, REPLIED);
  expect((await apiPost(DRAFTED.statusId))?.triage?.roughDraft).toBeTruthy();
  expect((await postJson(server.baseUrl, `/v1/posts/${REPLIED.statusId}/replied`, { replied: true })).ok).toBe(true);

  const page = await openTimeline(context, [FLAGGED, DRAFTED, REPLIED]);
  await expect(articleOf(page, FLAGGED).getByTestId('inline-draft-badge')).toHaveText('Ready', { timeout: 15_000 });
  await expect(articleOf(page, DRAFTED).getByTestId('inline-flag-pill')).toHaveText('+ Flag');
  await expect(articleOf(page, DRAFTED).getByTestId('inline-draft-badge')).toHaveCount(0);
  await expect(articleOf(page, REPLIED).getByTestId('inline-status-pill')).toHaveText('Replied');
  await expect(page.getByTestId('inline-draft-badge')).toHaveCount(1);
  await page.close();
});

test('+ Flag on a post the prefilter skipped shows Drafting…, then Ready; it lands in To reply tagged manual', async () => {
  const OLD = skippedPost('7201', 'Old quiet post worth a reply');
  await ingestTriaged(OLD);
  expect((await apiPost(OLD.statusId))?.triage?.skipReason).toMatch(/^older than/);

  const page = await openTimeline(context, [OLD]);
  const article = articleOf(page, OLD);
  writeFileSync(holdFile(), 'hold');
  await article.getByTestId('inline-flag-pill').click({ timeout: 15_000 });
  await expect(article.getByTestId('inline-status-pill')).toHaveText('Drafting…');
  expect(await page.evaluate(() => (window as unknown as { __leaked: number }).__leaked)).toBe(0);

  rmSync(holdFile(), { force: true });
  const badge = article.getByTestId('inline-draft-badge');
  await expect(badge).toHaveText('Ready', { timeout: 20_000 });
  await badge.click();
  await expect(page.getByTestId('inline-draft-text')).toHaveText(/Congrats on shipping/);

  const panel = await openFlagged();
  const row = panel.locator(`[data-status-id="${OLD.statusId}"]`);
  await expect(row).toContainText('manual');
  await row.getByTestId('mark-replied').click();
  await expect(row).toHaveCount(0);
  await page.reload();
  await expect(articleOf(page, OLD).getByTestId('inline-status-pill')).toHaveText('Replied', { timeout: 15_000 });
  await panel.close();
  await page.close();
});

test('flag route: token required, unknown 404, own post 409, idempotent, and triage never unflags it', async () => {
  const DRAFTED = post('7301', 'Unflagged but drafted [draft-anyway]');
  const OWN = post('7302', 'My own post', { handle: 'e2eowner' });
  await ingestTriaged(DRAFTED);
  expect((await postJson(server.baseUrl, '/v1/posts', { posts: [captured(OWN)] })).ok).toBe(true);
  expect(await toReplyIds()).not.toContain(DRAFTED.statusId);

  expect((await flag(DRAFTED.statusId, {})).status).toBe(401);
  expect((await flag('123456789')).status).toBe(404);
  expect((await flag(OWN.statusId)).status).toBe(409);

  const first = await flag(DRAFTED.statusId);
  expect(first.status).toBe(200);
  expect(await first.json()).toEqual({ state: 'drafted' });
  const flaggedAt = (await apiPost(DRAFTED.statusId))?.manualFlaggedAt;
  expect(flaggedAt).toEqual(expect.any(Number));
  expect((await flag(DRAFTED.statusId)).status).toBe(200);
  expect((await apiPost(DRAFTED.statusId))?.manualFlaggedAt).toBe(flaggedAt);
  expect((await toReplyIds()).filter((id) => id === DRAFTED.statusId)).toHaveLength(1);
  expect((await apiPost(DRAFTED.statusId))?.triage?.mustFlag).toBe('manual');

  const lookup = await fetch(`${server.baseUrl}/v1/posts/to-reply?ids=${DRAFTED.statusId},${OWN.statusId}`, { headers: authHeader });
  const body = (await lookup.json()) as { posts: { statusId: string }[]; flaggable: string[] };
  expect(body.posts.map((p) => p.statusId)).toEqual([DRAFTED.statusId]);
  expect(body.flaggable).toEqual([]);
});

test('while every model is out of quota, a flagged post shows when triage resumes, then Ready', async () => {
  const OLD = skippedPost('7401', 'Old post flagged during a quota pause');
  await ingestTriaged(OLD);
  writeFileSync(join(binDir, 'quota-message.txt'), 'Resource exhausted. Please retry in 8s.');
  writeFileSync(join(binDir, 'quota-models.txt'), 'google/fake-flash');

  const page = await openTimeline(context, [OLD]);
  const article = articleOf(page, OLD);
  await article.getByTestId('inline-flag-pill').click({ timeout: 15_000 });
  await expect(article.getByTestId('inline-status-pill')).toHaveText(/^Paused · resumes \d{1,2}:\d\d [AP]M · /, { timeout: 15_000 });

  rmSync(join(binDir, 'quota-models.txt'), { force: true });
  await expect(article.getByTestId('inline-draft-badge')).toHaveText('Ready', { timeout: 30_000 });
  await page.close();
});
