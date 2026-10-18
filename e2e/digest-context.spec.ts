// @covers apps/server/src/digest/**, apps/server/src/llm/**, apps/server/src/posts.ts, apps/server/src/router.ts, apps/server/src/app.ts, apps/server/src/main.ts, shared/src/config.ts
import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { authHeader, installFakeClis, makeTempDir, postJson, removeTempDirs, startServer, type TestServer } from './harness';

const HOUR = 3_600_000;
const BRIEF_TAIL = 'BRIEF-TAIL-NEVER-SENT';
const FOLDERS = ['2026-01-01_too-old', '2026-10-05_e', '2026-10-09_d', '2026-10-12_c', '2026-10-14_b', '2026-10-17_a'];

let server: TestServer;
let binDir: string;

function makeAnnouncements(): string {
  const root = makeTempDir('xc-ann-');
  for (const folder of FOLDERS) {
    mkdirSync(join(root, folder));
    writeFileSync(join(root, folder, 'brief.md'), `brief of ${folder}`);
    writeFileSync(join(root, folder, 'video.mp4'), 'MEDIA-BYTES');
  }
  writeFileSync(join(root, '2026-10-14_b', 'brief.md'), `brief of 2026-10-14_b ${'x'.repeat(3000)} ${BRIEF_TAIL}`);
  writeFileSync(join(root, 'tracker.csv'), 'date,plan,folder,discord,x,video,notes\n2026-10-17,a,2026-10-17_a,posted,drafted,-,"live, posted"\n');
  return root;
}

function makeRepo(): string {
  const repo = makeTempDir('xc-repo-');
  writeFileSync(join(repo, 'README.md'), '# Spacehub e2e README marker');
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', ...args], { cwd: repo });
  git('init', '-q');
  git('add', 'README.md');
  git('commit', '-q', '-m', 'feat: e2e marker commit');
  return repo;
}

test.beforeAll(async () => {
  const fakes = installFakeClis();
  binDir = fakes.binDir;
  const config = {
    handle: 'e2eowner',
    spacehoodRepoPath: makeRepo(),
    announcementsPath: makeAnnouncements(),
    product: { name: 'Spacehub' },
    digest: { everyNPosts: 2 },
    models: { triage: 'google/fake-flash', final: 'fake-final' },
  };
  server = await startServer(config, { ...fakes.env, GEMINI_API_KEY: 'fake-gemini-key-for-e2e' });
});

test.afterAll(async () => {
  await server?.stop();
  removeTempDirs();
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

test('digest prompt carries fresh product context: README, newest briefs first with tracker status, commits, within budget', async () => {
  expect((await postJson(server.baseUrl, '/v1/posts', { posts: [capturedPost('9101'), capturedPost('9102')] })).ok).toBe(true);
  const promptFile = join(binDir, 'opencode-digest-prompt.txt');
  await expect.poll(() => existsSync(promptFile), { timeout: 20_000 }).toBe(true);
  const prompt = readFileSync(promptFile, 'utf8');
  const context = /<product-context>\n([\s\S]*)\n<\/product-context>/.exec(prompt)?.[1] ?? '';

  expect(prompt).toContain("The builder's product is Spacehub.");
  expect(prompt).toContain('never promotional');
  expect(context).toContain('# Spacehub e2e README marker');
  expect(context).toContain('feat: e2e marker commit');
  expect(context).toContain('status="discord=posted, x=drafted, video=-; notes: live, posted"');
  const order = ['2026-10-17_a', '2026-10-14_b', '2026-10-12_c', '2026-10-09_d', '2026-10-05_e'].map((f) => context.indexOf(`brief of ${f}`));
  expect(order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1]!))).toBe(true);
  expect(context).not.toContain('too-old');
  expect(context).not.toContain(BRIEF_TAIL);
  expect(context).not.toContain('MEDIA-BYTES');
  expect(Buffer.byteLength(context)).toBeLessThanOrEqual(8 * 1024);

  await expect
    .poll(async () => ((await (await fetch(`${server.baseUrl}/v1/digest`, { headers: authHeader })).json()) as { digest: { trends: { title: string }[] } | null }).digest?.trends[0]?.title)
    .toBe('Fake trend');
});
