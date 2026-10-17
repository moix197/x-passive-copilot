// @covers apps/extension/src/panel/**, apps/server/src/text/**, apps/server/src/voice/**, apps/server/src/digest/**, apps/server/src/polish/**, apps/server/src/posts.ts, apps/server/src/router.ts, apps/server/src/db.ts, apps/server/src/app.ts, apps/server/src/triage/**, apps/server/src/llm/**, apps/server/src/main.ts, apps/server/src/env-file.ts, apps/server/src/doctor.ts, shared/src/types.ts
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

async function openPanelTab(name: string): Promise<Page> {
  const extensionId = await pointExtensionAtServer(context, server.baseUrl);
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 400, height: 1100 });
  await panel.goto(`chrome-extension://${extensionId}/panel.html`);
  await panel.getByRole('tab', { name }).click();
  return panel;
}

const openFlagged = () => openPanelTab('Flagged');
const lastPrompt = (cli: 'opencode' | 'claude') => readFileSync(join(binDir, `${cli}-last-prompt.txt`), 'utf8');

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
  await expect(row.getByTestId('first-draft')).toContainText('The hardest part, was it scope?');
  await expect(row.getByTestId('first-draft')).not.toContainText('—');
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
  const viewOnX = original.getByTestId('view-on-x-link');
  await expect(viewOnX).toHaveText('View on X ↗');
  await expect(viewOnX).toHaveAttribute('href', 'https://x.com/nora/status/8101');
  await expect(viewOnX).toHaveAttribute('target', '_blank');
  await expect(viewOnX).toHaveAttribute('rel', 'noopener noreferrer');

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
  await expect(claude.getByTestId('claude-text')).toHaveText(/^Shipping beats polishing, what did you cut/, { timeout: 20_000 });
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

test('style notes save, survive a panel reload and reach the triage and polish prompts', async () => {
  const notes = 'never use em dashes\nkeep it short, lowercase ok';
  let panel = await openPanelTab('Voice');
  const input = panel.getByTestId('style-notes-input');
  await expect(input).toBeEnabled({ timeout: 15_000 });
  await input.fill(notes);
  await panel.getByTestId('style-notes-save').click();
  await expect(panel.getByTestId('style-notes-state')).toHaveText('Saved');

  await panel.close();
  panel = await openPanelTab('Voice');
  await expect(panel.getByTestId('style-notes-input')).toHaveValue(notes, { timeout: 15_000 });

  expect((await postJson(server.baseUrl, '/v1/posts', { posts: [capturedPost('8301', { authorHandle: 'mina', text: 'Launching today' })] })).ok).toBe(true);
  panel = await openFlagged();
  const claude = panel.locator('[data-status-id="8301"]').getByTestId('claude-version');
  await expect(panel.locator('[data-status-id="8301"]').getByTestId('first-draft')).toBeVisible({ timeout: 20_000 });
  expect(lastPrompt('opencode')).toMatch(/<user-style-rules>\nnever use em dashes\nkeep it short, lowercase ok\n<\/user-style-rules>/);

  await claude.getByTestId('polish-button').click();
  await expect(claude.getByTestId('claude-text')).toBeVisible({ timeout: 20_000 });
  expect(lastPrompt('claude')).toContain('<user-style-rules>\nnever use em dashes');
});

test('style notes reject oversized input', async () => {
  const res = await postJson(server.baseUrl, '/v1/style-notes', { notes: 'x'.repeat(2001) });
  expect(res.status).toBe(400);
});

test('editing a Claude version keeps focus across polls, saves the edit as the shown text and survives a reload', async () => {
  const post = capturedPost('8401', { authorName: 'Ines', authorHandle: 'ines', text: 'Which feature would you cut first?' });
  expect((await postJson(server.baseUrl, '/v1/posts', { posts: [post] })).ok).toBe(true);
  let panel = await openFlagged();
  let claude = panel.locator('[data-status-id="8401"]').getByTestId('claude-version');
  await claude.getByTestId('polish-button').click({ timeout: 20_000 });
  const original = claude.getByTestId('claude-text');
  await expect(original).toBeVisible({ timeout: 20_000 });
  const originalText = await original.textContent();

  await claude.getByTestId('draft-edit').click();
  const editor = claude.getByTestId('draft-editor');
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue(originalText ?? '');
  const [editorBox, sectionBox] = [await editor.boundingBox(), await claude.boundingBox()];
  expect(editorBox!.width).toBeGreaterThan(sectionBox!.width * 0.85);

  const shortHeight = (await editor.boundingBox())!.height;
  await editor.fill('A much longer reply that wraps over many lines in the narrow side panel. '.repeat(4));
  await expect.poll(async () => (await editor.boundingBox())!.height).toBeGreaterThan(shortHeight);

  // Typing low in a scrolled panel must survive the 3s list refresh: same scroll, focus and text.
  await panel.setViewportSize({ width: 400, height: 500 });
  await editor.fill('Cut the settings page');
  await editor.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const scrollY = await panel.evaluate(() => window.scrollY);
  expect(scrollY).toBeGreaterThan(0);
  await panel.keyboard.type(' fir');
  await panel.waitForResponse((r) => r.url().includes('/v1/posts'));
  await panel.waitForResponse((r) => r.url().includes('/v1/posts'));
  await expect(editor).toBeFocused();
  await panel.keyboard.type('st');
  await expect(editor).toHaveValue('Cut the settings page first');
  expect(await panel.evaluate(() => window.scrollY)).toBe(scrollY);

  await panel.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);
  await expect(original).toHaveText(originalText ?? '');

  await claude.getByTestId('draft-edit').click();
  await editor.fill('lfg #ship #now');
  await claude.getByTestId('draft-save').click();
  await expect(claude).toContainText('guard: hashtags, hype-word');
  await expect(editor).toBeVisible();

  const edited = 'Cut the settings page first, nobody opens it';
  await editor.fill(edited);
  await panel.keyboard.press('Control+Enter');
  await expect(editor).toHaveCount(0);
  await expect(original).toHaveText(edited);
  await expect(claude).not.toContainText('Needs edit');

  await panel.close();
  panel = await openFlagged();
  claude = panel.locator('[data-status-id="8401"]').getByTestId('claude-version');
  await expect(claude.getByTestId('claude-text')).toHaveText(edited, { timeout: 15_000 });
  await claude.getByTestId('draft-edit').click();
  await expect(claude.getByTestId('draft-editor')).toHaveValue(edited);
});
