// @covers apps/extension/src/content/**, apps/extension/src/background/**, apps/extension/src/drafts/**, apps/extension/src/server-api.ts, apps/server/src/posts.ts, apps/server/src/router.ts, apps/server/src/app.ts, apps/server/src/triage/**, shared/src/types.ts, e2e/fakes/**, e2e/x-timeline.ts
import { expect, test, type BrowserContext } from '@playwright/test';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { installFakeClis, launchExtension, makeTempDir, pointExtensionAtServer, removeTempDirs, startServer, type TestServer } from './harness';
import { articleOf, openTimeline, type Post } from './x-timeline';

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
  };
  server = await startServer(config, { ...fakes.env, GEMINI_API_KEY: 'fake-gemini-key-for-e2e' });
  context = await launchExtension();
  await pointExtensionAtServer(context, server.baseUrl);
});

test.afterAll(async () => {
  await context?.close();
  await server?.stop();
  removeTempDirs();
});

const holdFile = () => join(binDir, 'triage-hold.txt');
test.afterEach(() => rmSync(holdFile(), { force: true }));

// Regression: the first lookup ran before the content script's capture reached the server, so a fresh post
// had no pill until the 15s refresh, and Ready waited another 15s after triage.
test('a fresh post gets + Flag before triage finishes, then upgrades to Ready soon after triage', async () => {
  const FRESH: Post = { statusId: '8801', handle: 'someone', text: 'Fresh post never captured before' };
  writeFileSync(holdFile(), 'hold');
  const startedAt = Date.now();
  const page = await openTimeline(context, [FRESH]);
  const article = articleOf(page, FRESH);

  await expect(article.getByTestId('inline-flag-pill')).toHaveText('+ Flag', { timeout: 5_000 });
  test.info().annotations.push({ type: 'flag-pill-ms', description: String(Date.now() - startedAt) });

  const releasedAt = Date.now();
  rmSync(holdFile(), { force: true });
  await expect(article.getByTestId('inline-draft-badge')).toHaveText('Ready', { timeout: 6_000 });
  test.info().annotations.push({ type: 'ready-after-triage-ms', description: String(Date.now() - releasedAt) });
  await page.close();
});
