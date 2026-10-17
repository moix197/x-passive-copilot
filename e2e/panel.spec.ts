// @covers apps/extension/src/panel/**, apps/server/src/polish/**, apps/server/src/posts.ts, apps/server/src/router.ts, apps/server/src/db.ts, apps/server/src/app.ts, apps/server/src/triage/**, apps/server/src/llm/**, apps/server/src/main.ts, apps/server/src/env-file.ts, apps/server/src/doctor.ts, shared/src/types.ts
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
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
const FAKE_GEMINI_KEY = 'fake-gemini-key-for-e2e';
const AVATAR = 'https://pbs.twimg.com/profile_images/9/grace_normal.png';

let server: TestServer;
let context: BrowserContext;
let binDir: string;

test.beforeAll(async () => {
  const fakes = installFakeClis();
  binDir = fakes.binDir;
  const config = {
    handle: 'e2eowner',
    spacehoodRepoPath: makeTempDir('xc-repo-'),
    models: { triage: 'google/fake-flash', final: 'fake-final' },
    triage: { batchSize: 1 },
    autoPolish: { dailyCap: 0 },
  };
  server = await startServer(config, { ...fakes.env, GEMINI_API_KEY: FAKE_GEMINI_KEY });
  context = await launchExtension();
  await fakeTwimg(context);
});

test.afterAll(async () => {
  await context?.close();
  await server?.stop();
  removeTempDirs();
});

function capturedPost(statusId: string, overrides: object) {
  return {
    statusId,
    authorName: 'N',
    authorHandle: 'someone',
    text: 'post',
    postedAt: new Date(Date.now() - 2 * HOUR).toISOString(),
    metrics: { replies: 2, reposts: 3, likes: 40, views: 900 },
    isReply: false,
    replyTo: [],
    quotedStatusId: null,
    ...overrides,
  };
}

async function openFlagged(): Promise<Page> {
  const extensionId = await pointExtensionAtServer(context, server.baseUrl);
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 400, height: 1100 });
  await panel.goto(`chrome-extension://${extensionId}/panel.html`);
  await panel.getByRole('tab', { name: 'Flagged' }).click();
  return panel;
}

// The Gemini key must reach only the opencode child, re-mapped to the google provider's var.
function expectGeminiEnv(cli: 'opencode' | 'claude', google: string | null) {
  const seen = JSON.parse(readFileSync(join(binDir, `${cli}-last-env.json`), 'utf8')) as Record<string, string | null>;
  expect(seen).toEqual({ gemini: null, google });
}

async function storedVersions(statusId: string) {
  const res = await fetch(`${server.baseUrl}/v1/posts?view=flagged&limit=50`, { headers: authHeader });
  const body = (await res.json()) as { posts: { statusId: string; polish: { versions: { status: string }[] } | null }[] };
  return body.posts.find((p) => p.statusId === statusId)?.polish?.versions ?? [];
}

test('flagged card shows the original post like X, then the first draft and the Claude version', async () => {
  const posts = [
    capturedPost('8101', { authorName: 'Nora Builder', authorHandle: 'nora', text: 'Shipped v2 of our indexer today' }),
    capturedPost('8102', { authorName: 'Grace', authorHandle: 'grace', text: 'Testing in prod again', avatarUrl: AVATAR }),
  ];
  expect((await postJson(server.baseUrl, '/v1/posts', { posts })).ok).toBe(true);
  const panel = await openFlagged();
  const row = panel.locator('[data-status-id="8101"]');
  const original = row.getByTestId('original-post');

  await expect(row.getByTestId('first-draft')).toContainText('Congrats on shipping!', { timeout: 20_000 });
  await expect(row.getByTestId('first-draft')).toContainText('First draft');
  await expect(original).toContainText('Nora Builder');
  await expect(original).toContainText('@nora');
  await expect(original).toContainText('40 likes');
  await expect(original.getByTestId('avatar-initials')).toHaveText('NB');
  const time = original.getByTestId('post-time-link');
  await expect(time).toHaveText('2h');
  await expect(time).toHaveAttribute('href', 'https://x.com/nora/status/8101');
  await expect(time).toHaveAttribute('title', /^\d{1,2}:\d{2} [AP]M · [A-Z][a-z]{2} \d{1,2}, \d{4}$/);
  await expect(row.getByTestId('claude-version')).toContainText('Claude version');

  const avatar = panel.locator('[data-status-id="8102"]').getByTestId('original-post').getByTestId('avatar');
  await expect(avatar).toHaveAttribute('src', AVATAR);
  await expect.poll(() => avatar.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  expectGeminiEnv('opencode', FAKE_GEMINI_KEY);
});

test('regenerate keeps every version, flips between them and persists the pick', async () => {
  const post = capturedPost('8201', { authorName: 'Ravi', authorHandle: 'ravi', text: 'What should we cut before launch?' });
  expect((await postJson(server.baseUrl, '/v1/posts', { posts: [post] })).ok).toBe(true);
  let panel = await openFlagged();
  let claude = panel.locator('[data-status-id="8201"]').getByTestId('claude-version');

  await claude.getByTestId('polish-button').click({ timeout: 20_000 });
  await expect(claude.getByTestId('claude-text')).toHaveText(/^Shipping beats polishing/, { timeout: 20_000 });
  await expect(claude.getByTestId('version-label')).toHaveCount(0);

  await claude.getByTestId('draft-regenerate').click();
  await expect(claude.getByTestId('version-label')).toHaveText('2/2', { timeout: 20_000 });
  await expect(claude.getByTestId('claude-text')).toHaveText(/^Small releases/);
  expect(readFileSync(join(binDir, 'claude-last-prompt.txt'), 'utf8')).toContain('Shipping beats polishing');
  expectGeminiEnv('claude', null);

  await claude.getByTestId('version-prev').click();
  await expect(claude.getByTestId('version-label')).toHaveText('1/2');
  await expect(claude.getByTestId('claude-text')).toHaveText(/^Shipping beats polishing/);
  await expect(claude.getByTestId('version-prev')).toBeDisabled();

  await panel.close();
  panel = await openFlagged();
  claude = panel.locator('[data-status-id="8201"]').getByTestId('claude-version');
  await expect(claude.getByTestId('version-label')).toHaveText('1/2', { timeout: 15_000 });
  await expect(claude.getByTestId('claude-text')).toHaveText(/^Shipping beats polishing/);

  // The fake now only writes guard-breaking replies: the new version is kept but flagged.
  await claude.getByTestId('draft-regenerate').click();
  await expect(claude.getByTestId('version-label')).toHaveText('3/3', { timeout: 20_000 });
  await expect(claude).toContainText('Needs edit: hashtags, hype-word');
  expect((await storedVersions('8201')).map((v) => v.status)).toEqual(['ready', 'ready', 'needs_edit']);

  await claude.getByTestId('version-prev').click();
  await expect(claude.getByTestId('version-label')).toHaveText('2/3');
  await expect(claude).not.toContainText('Needs edit');
  await panel.screenshot({ path: test.info().outputPath('flagged-panel.png'), fullPage: true });
});
