// @covers apps/extension/src/panel/**, apps/server/src/text/**, apps/server/src/voice/**, apps/server/src/digest/**, apps/server/src/polish/**, apps/server/src/posts.ts, apps/server/src/router.ts, apps/server/src/db.ts, apps/server/src/app.ts, apps/server/src/triage/**, apps/server/src/llm/**, apps/server/src/sandbox.ts, apps/server/assets/**, apps/server/src/main.ts, apps/server/src/env-file.ts, apps/server/src/doctor.ts, shared/src/types.ts
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
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
import { MAX_DRAFT_VERSIONS } from '../shared/src/types';

const HOUR = 3_600_000;
const FAKE_GEMINI_KEY = 'fake-gemini-key-for-e2e';
const AVATAR = 'https://pbs.twimg.com/profile_images/9/grace_normal.png';

let server: TestServer;
let context: BrowserContext;
let binDir: string;

test.beforeAll(async () => {
  const fakes = installFakeClis();
  binDir = fakes.binDir;
  const repo = makeTempDir('xc-repo-');
  mkdirSync(join(repo, '.claude/skills/announce'), { recursive: true });
  writeFileSync(join(repo, '.claude/skills/announce/voice.md'), 'voice guide');
  writeFileSync(join(repo, 'CLAUDE.md'), 'product repo instructions');
  const config = {
    handle: 'e2eowner',
    spacehoodRepoPath: repo,
    models: { triage: 'google/fake-flash', final: 'fake-final' },
    triage: { batchSize: 1 },
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

// Polls never overlap, so the second response means the first one has been fully rendered.
async function nextFullPoll(panel: Page): Promise<void> {
  await panel.waitForResponse((r) => r.url().includes('/v1/posts'));
  await panel.waitForResponse((r) => r.url().includes('/v1/posts'));
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

test('a reply that pitches the product is flagged, and reply polish runs outside the product repo', async () => {
  const post = capturedPost('8251', { authorHandle: 'tara', text: 'pitch-probe: how do you tell a real burn from dust?' });
  expect((await postJson(server.baseUrl, '/v1/posts', { posts: [post] })).ok).toBe(true);
  const panel = await openFlagged();
  const claude = panel.locator('[data-status-id="8251"]').getByTestId('claude-version');

  await claude.getByTestId('polish-button').click({ timeout: 20_000 });
  await expect(claude.getByTestId('claude-text')).toHaveText(/^We built Spacehub/, { timeout: 20_000 });
  await expect(claude).toContainText('Needs edit: product-mention');
  expect(lastPrompt('claude')).toContain("DON'T: pitch, plug or mention Spacehub");
  expect(lastPrompt('claude')).not.toContain('.ai/product');

  const cwd = readFileSync(join(binDir, 'claude-last-cwd.txt'), 'utf8');
  expect([basename(dirname(cwd)), basename(cwd)]).toEqual(['sandbox', 'claude-reply']);
  expect(readFileSync(join(cwd, 'voice.md'), 'utf8')).toBe('voice guide');
  expect(existsSync(join(cwd, 'CLAUDE.md'))).toBe(false);
  await panel.close();
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
  await nextFullPoll(panel);
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

test('thumbs show a pressed state with confirmation, switch, survive polls and a reload, and fit one row', async () => {
  const post = capturedPost('8601', { authorName: 'Tao', authorHandle: 'tao', text: 'What would you ship this week?' });
  expect((await postJson(server.baseUrl, '/v1/posts', { posts: [post] })).ok).toBe(true);
  let panel = await openFlagged();
  let claude = panel.locator('[data-status-id="8601"]').getByTestId('claude-version');
  await claude.getByTestId('polish-button').click({ timeout: 20_000 });
  await expect(claude.getByTestId('claude-text')).toBeVisible({ timeout: 20_000 });
  const up = claude.getByTestId('draft-up');
  const down = claude.getByTestId('draft-down');
  await expect(up).toHaveAttribute('aria-pressed', 'false');

  const copyBox = await claude.getByTestId('draft-copy').boundingBox();
  const downBox = await down.boundingBox();
  expect(Math.abs((downBox?.y ?? 0) - (copyBox?.y ?? 99))).toBeLessThan(4);

  await up.click();
  await expect(up).toHaveAttribute('aria-pressed', 'true');
  await expect(down).toHaveAttribute('aria-pressed', 'false');
  await expect(claude).toContainText('Saved as good example');
  await nextFullPoll(panel);
  await expect(claude.getByTestId('draft-up')).toHaveAttribute('aria-pressed', 'true');

  await claude.getByTestId('draft-down').click();
  await expect(claude.getByTestId('draft-down')).toHaveAttribute('aria-pressed', 'true');
  await expect(claude.getByTestId('draft-up')).toHaveAttribute('aria-pressed', 'false');
  await expect(claude).toContainText('Saved as example to avoid');

  await panel.close();
  panel = await openFlagged();
  claude = panel.locator('[data-status-id="8601"]').getByTestId('claude-version');
  await expect(claude.getByTestId('draft-down')).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
  await expect(claude.getByTestId('draft-up')).toHaveAttribute('aria-pressed', 'false');
});

test('a high-score post is never polished automatically by default', async () => {
  const post = capturedPost('8701', { authorName: 'Uma', authorHandle: 'uma', text: 'Launching our beta tomorrow' });
  expect((await postJson(server.baseUrl, '/v1/posts', { posts: [post] })).ok).toBe(true);
  const panel = await openFlagged();
  const row = panel.locator('[data-status-id="8701"]');
  await expect(row.getByTestId('first-draft')).toContainText('Congrats on shipping!', { timeout: 20_000 });
  await expect(row.getByTestId('polish-button')).toBeVisible();
  await nextFullPoll(panel);
  await expect(row.getByTestId('polish-button')).toBeVisible();
  await expect(row.getByTestId('claude-text')).toHaveCount(0);
  await expect(row.getByTestId('claude-version')).not.toContainText('Top pick');
});

test('first draft thumbs and edit are independent of the Claude version, guarded and persisted', async () => {
  const post = capturedPost('8801', { authorName: 'Vik', authorHandle: 'vik', text: 'What are you building this week?' });
  expect((await postJson(server.baseUrl, '/v1/posts', { posts: [post] })).ok).toBe(true);
  let panel = await openFlagged();
  let row = panel.locator('[data-status-id="8801"]');
  let rough = row.getByTestId('first-draft');
  let claude = row.getByTestId('claude-version');
  await claude.getByTestId('polish-button').click({ timeout: 20_000 });
  await expect(claude.getByTestId('claude-text')).toBeVisible({ timeout: 20_000 });

  await rough.getByTestId('draft-up').click();
  await expect(rough.getByTestId('draft-up')).toHaveAttribute('aria-pressed', 'true');
  await expect(rough).toContainText('Saved as good example');
  await expect(claude.getByTestId('draft-up')).toHaveAttribute('aria-pressed', 'false');
  await claude.getByTestId('draft-down').click();
  await expect(claude.getByTestId('draft-down')).toHaveAttribute('aria-pressed', 'true');
  await expect(rough.getByTestId('draft-up')).toHaveAttribute('aria-pressed', 'true');
  await expect(rough.getByTestId('draft-down')).toHaveAttribute('aria-pressed', 'false');

  await rough.getByTestId('draft-edit').click();
  const editor = rough.getByTestId('draft-editor');
  await expect(editor).toBeFocused();
  await editor.fill('lfg #ship #now');
  await rough.getByTestId('draft-save').click();
  await expect(rough).toContainText('guard: hashtags, hype-word');
  const edited = 'What is the one thing you would cut first?';
  await editor.fill(edited);
  await rough.getByTestId('draft-save').click();
  await expect(editor).toHaveCount(0);
  await expect(rough.locator('.reply-text')).toHaveText(edited);

  await panel.close();
  panel = await openFlagged();
  row = panel.locator('[data-status-id="8801"]');
  rough = row.getByTestId('first-draft');
  claude = row.getByTestId('claude-version');
  await expect(rough.locator('.reply-text')).toHaveText(edited, { timeout: 15_000 });
  await expect(rough.getByTestId('draft-up')).toHaveAttribute('aria-pressed', 'true');
  await expect(claude.getByTestId('draft-down')).toHaveAttribute('aria-pressed', 'true');
  await expect(claude.getByTestId('draft-up')).toHaveAttribute('aria-pressed', 'false');

  const copied = await postJson(server.baseUrl, '/v1/drafts/rough-8801/feedback', { kind: 'copy' });
  expect(copied.status).toBe(200);
});

function doctorCheck(id: string, status: string, detail: string | null, fix: string | null) {
  return { id, label: id, status, detail, fix };
}

async function openReadiness(checks: object[]): Promise<Page> {
  const extensionId = await pointExtensionAtServer(context, server.baseUrl);
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 400, height: 700 });
  await panel.route('**/v1/doctor', (route) => route.fulfill({ json: { checks } }));
  await panel.goto(`chrome-extension://${extensionId}/panel.html`);
  const worker = context.serviceWorkers()[0]!;
  await worker.evaluate(() => chrome.storage.session.set({ linkStatus: { state: 'online', message: null } }));
  return panel;
}

test('readiness collapses to one summary line when every check is ok', async () => {
  const panel = await openReadiness([doctorCheck('claude', 'ok', '2.1.0', null), doctorCheck('handle', 'ok', null, null)]);
  await expect(panel.getByText('All systems ready')).toBeVisible();
  await expect(panel.getByRole('list', { name: 'Readiness checks' })).toBeHidden();
  await panel.getByText('All systems ready').click();
  await expect(panel.getByRole('list', { name: 'Readiness checks' })).toBeVisible();
  await panel.close();
});

test('readiness opens with the failing row, its status text and a readable fix hint', async () => {
  const fix = 'Create /tmp/context.md describing what you build';
  const panel = await openReadiness([
    doctorCheck('claude', 'ok', '2.1.0', 'ignored for ok rows'),
    doctorCheck('context.md', 'missing', null, fix),
  ]);
  await expect(panel.getByText('1 issue needs attention')).toBeVisible();
  await expect(panel.getByText(fix)).toBeVisible();
  await expect(panel.getByText('missing', { exact: true })).toBeVisible();
  await expect(panel.getByText('ignored for ok rows')).toHaveCount(0);
  expect(await panel.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await panel.close();
});

test('flagged list is newest-captured first and a post flagged while the panel is open appears at the top', async () => {
  const mention = (id: string) => capturedPost(id, { text: `@e2eowner order check ${id}`, authorHandle: 'orderer' });
  const mine = ['7101', '7102', '7103'];
  const order = (panel: Page) =>
    panel
      .getByTestId('flagged-row')
      .evaluateAll((rows) => rows.map((r) => (r as HTMLElement).dataset.statusId ?? ''))
      .then((ids) => ids.filter((id) => mine.includes(id)));

  expect((await postJson(server.baseUrl, '/v1/posts', { posts: [mention('7101')] })).ok).toBe(true);
  expect((await postJson(server.baseUrl, '/v1/posts', { posts: [mention('7102')] })).ok).toBe(true);
  const panel = await openFlagged();
  await expect.poll(() => order(panel)).toEqual(['7102', '7101']);

  expect((await postJson(server.baseUrl, '/v1/posts', { posts: [mention('7103')] })).ok).toBe(true);
  await expect.poll(() => order(panel)).toEqual(['7103', '7102', '7101']);
});

test('closing one draft editor keeps the other open editor and its unsaved text across polls', async () => {
  const post = capturedPost('8901', { authorName: 'Wen', authorHandle: 'wen', text: 'What did you drop from the roadmap?' });
  expect((await postJson(server.baseUrl, '/v1/posts', { posts: [post] })).ok).toBe(true);
  const panel = await openFlagged();
  const row = panel.locator('[data-status-id="8901"]');
  const rough = row.getByTestId('first-draft');
  const claude = row.getByTestId('claude-version');
  await claude.getByTestId('polish-button').click({ timeout: 20_000 });
  await expect(claude.getByTestId('claude-text')).toBeVisible({ timeout: 20_000 });

  await rough.getByTestId('draft-edit').click();
  await rough.getByTestId('draft-editor').fill('unsaved first draft edit');
  await claude.getByTestId('draft-edit').click();
  await claude.getByTestId('draft-editor').fill('unsaved claude edit');
  await claude.getByTestId('draft-cancel').click();
  await expect(claude.getByTestId('draft-editor')).toHaveCount(0);

  await nextFullPoll(panel);
  await expect(rough.getByTestId('draft-editor')).toHaveValue('unsaved first draft edit');
  await panel.close();
});

test('regenerate stops at the version cap with 409 limit and the panel hides the button', async () => {
  const id = '8951';
  expect((await postJson(server.baseUrl, '/v1/posts', { posts: [capturedPost(id, { authorHandle: 'cap', text: 'Cap probe' })] })).ok).toBe(true);
  const polish = (regenerate: boolean) => postJson(server.baseUrl, `/v1/posts/${id}/polish${regenerate ? '?regenerate=1' : ''}`, {});
  // Asking again while a job runs answers "already", so each step re-asks until the next version lands; a stale count read can fire one extra ask that lands a version early, so wait for "at least n".
  for (let n = 1; n <= MAX_DRAFT_VERSIONS; n++) {
    const askNext = async () => {
      const count = (await storedVersions(id)).length;
      if (count < n) await polish(n > 1);
      return count;
    };
    await expect.poll(askNext, { timeout: 20_000 }).toBeGreaterThanOrEqual(n);
  }
  await expect.poll(async () => (await storedVersions(id)).length).toBe(MAX_DRAFT_VERSIONS);
  const capped = await polish(true);
  expect(capped.status).toBe(409);
  expect(await capped.json()).toMatchObject({ state: 'limit' });

  const panel = await openFlagged();
  const claude = panel.locator(`[data-status-id="${id}"]`).getByTestId('claude-version');
  await expect(claude.getByTestId('version-label')).toHaveText(`${MAX_DRAFT_VERSIONS}/${MAX_DRAFT_VERSIONS}`, { timeout: 15_000 });
  await expect(claude.getByTestId('draft-regenerate')).toHaveCount(0);
  await panel.close();
});
