// @covers apps/server/src/posts.ts, apps/server/src/router.ts, apps/server/src/triage/**, apps/server/src/db.ts, shared/src/types.ts, e2e/fakes/opencode.mjs
import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { authHeader, installFakeClis, makeTempDir, postJson, removeTempDirs, startServer, type TestServer } from './harness';

const HOUR = 3_600_000;
let server: TestServer | undefined;

test.afterAll(async () => {
  await server?.stop();
  removeTempDirs();
});

const flaggedIds = async (baseUrl: string) => {
  const res = await fetch(`${baseUrl}/v1/posts?limit=50&view=flagged`, { headers: authHeader });
  return ((await res.json()) as { posts: { statusId: string }[] }).posts.map((p) => p.statusId);
};

// The post is reply-worthy and fresh under the 24h limit; restarting on the same data with a 1h limit makes it stale.
test('a reply-worthy post past the age limit leaves To reply and the inline lookup', async () => {
  const fakes = installFakeClis();
  const config = (maxAgeHours: number) => ({
    handle: 'e2eowner',
    spacehoodRepoPath: makeTempDir('xc-repo-'),
    models: { triage: 'google/fake-flash', final: 'fake-final' },
    triage: { batchSize: 1, maxAgeHours },
  });
  const env = { ...fakes.env, GEMINI_API_KEY: 'fake-gemini-key-for-e2e' };
  server = await startServer(config(24), env);
  const post = {
    statusId: '6401', authorName: 'N', authorHandle: 'someone', text: 'about to age out',
    postedAt: new Date(Date.now() - 2 * HOUR).toISOString(),
    metrics: { replies: 2, reposts: 3, likes: 40, views: 900 }, isReply: false, replyTo: [], quotedStatusId: null,
  };
  expect((await postJson(server.baseUrl, '/v1/posts', { posts: [post] })).ok).toBe(true);
  await expect.poll(() => flaggedIds(server!.baseUrl)).toEqual(['6401']);
  await expect
    .poll(async () => {
      const res = await fetch(`${server!.baseUrl}/v1/posts?limit=50`, { headers: authHeader });
      const body = (await res.json()) as { posts: { triage: { replyWorthy: boolean } | null }[] };
      return body.posts[0]?.triage?.replyWorthy;
    })
    .toBe(true);

  const { home } = server;
  await server.stop();
  writeFileSync(join(home, 'config.json'), JSON.stringify(config(1)));
  server = await startServer(config(1), env, home);

  expect(await flaggedIds(server.baseUrl)).toEqual([]);
  const res = await fetch(`${server.baseUrl}/v1/posts/to-reply?ids=6401`, { headers: authHeader });
  expect(((await res.json()) as { posts: unknown[] }).posts).toEqual([]);
});
