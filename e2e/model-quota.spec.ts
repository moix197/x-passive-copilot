// @covers apps/server/src/llm/**, apps/server/src/triage/**, apps/server/src/meta.ts, apps/server/src/doctor.ts, apps/server/src/digest/**, apps/server/src/voice/**, apps/server/src/app.ts, apps/server/src/router.ts, apps/server/src/posts.ts, apps/server/src/sandbox.ts, shared/src/config.ts, shared/src/types.ts
import { expect, test } from '@playwright/test';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { authHeader, installFakeClis, postJson, removeTempDirs, startServer, type TestServer } from './harness';

const PRIMARY = 'google/fake-primary';
const FALLBACK = 'google/fake-fallback';
let server: TestServer;
let binDir: string;

test.afterEach(async () => {
  await server?.stop();
  removeTempDirs();
});

async function start(triage: object = {}): Promise<void> {
  const fakes = installFakeClis();
  binDir = fakes.binDir;
  const config = {
    handle: 'e2eowner',
    triage: { batchSize: 1, minEngagement: 0, ...triage },
    digest: { everyNPosts: 1000 },
    models: { triage: PRIMARY, triageFallbacks: [FALLBACK], final: 'fake-final' },
  };
  server = await startServer(config, { ...fakes.env, GEMINI_API_KEY: 'fake-gemini-key-for-e2e' });
}

const post = (statusId: string, postedAt: string | null = null) => ({
  statusId,
  authorName: 'N',
  authorHandle: 'someone',
  text: `timeline post ${statusId}`,
  postedAt,
  metrics: { replies: 2, reposts: 3, likes: 40, views: 900 },
  isReply: false,
  replyTo: [],
  quotedStatusId: null,
});

const ingest = async (...posts: ReturnType<typeof post>[]) => expect((await postJson(server.baseUrl, '/v1/posts', { posts })).ok).toBe(true);
const quotaOn = (...models: string[]) => writeFileSync(join(binDir, 'quota-models.txt'), models.join('\n'));
const calls = () => (existsSync(join(binDir, 'opencode-calls.txt')) ? readFileSync(join(binDir, 'opencode-calls.txt'), 'utf8').split('\n').filter(Boolean) : []);

interface ApiPost {
  statusId: string;
  triage: { score: number | null; skipReason: string | null; error: string | null } | null;
}

async function triageOf(statusId: string): Promise<ApiPost['triage'] | undefined> {
  const res = await fetch(`${server.baseUrl}/v1/posts?limit=100`, { headers: authHeader });
  const { posts } = (await res.json()) as { posts: ApiPost[] };
  return posts.find((p) => p.statusId === statusId)?.triage;
}

async function quotaDetail(): Promise<string | null> {
  const res = await fetch(`${server.baseUrl}/v1/doctor`, { headers: authHeader });
  const { checks } = (await res.json()) as { checks: { id: string; detail: string | null }[] };
  return checks.find((c) => c.id === 'model-quota')?.detail ?? null;
}

test('a quota error on the primary model falls back to the next one at once and keeps using it', async () => {
  await start();
  quotaOn(PRIMARY);
  await ingest(post('9301'));
  await expect.poll(async () => (await triageOf('9301'))?.score).toBe(90);
  expect(calls()).toEqual([`${PRIMARY} triage`, `${FALLBACK} triage`]);

  await ingest(post('9302'));
  await expect.poll(async () => (await triageOf('9302'))?.score).toBe(90);
  expect(calls()).toEqual([`${PRIMARY} triage`, `${FALLBACK} triage`, `${FALLBACK} triage`]);
  expect(await quotaDetail()).toMatch(new RegExp(`^Gemini quota reached for ${PRIMARY} until \\d\\d:\\d\\d, using ${FALLBACK}$`));
});

test('with every model out of quota triage pauses, posts stay untriaged, and the backlog is picked up after the reset within age limits', async () => {
  // 7.2s age limit: a post 4s old at ingest is fresh then but stale once the 6s pause ends.
  await start({ maxAgeHours: 0.002 });
  writeFileSync(join(binDir, 'quota-message.txt'), 'Resource exhausted. Please retry in 6s.');
  quotaOn(PRIMARY, FALLBACK);
  await ingest(post('9311'), post('9312', new Date(Date.now() - 4000).toISOString()));
  await expect.poll(() => calls()).toEqual([`${PRIMARY} triage`, `${FALLBACK} triage`]);

  expect(await triageOf('9311')).toBeNull();
  expect(await triageOf('9312')).toBeNull();
  expect(await quotaDetail()).toMatch(/triage and digest paused until \d\d:\d\d$/);
  await ingest(post('9313'));
  expect(calls()).toHaveLength(2);

  rmSync(join(binDir, 'quota-models.txt'));
  await expect.poll(async () => (await triageOf('9311'))?.score, { timeout: 20_000 }).toBe(90);
  await expect.poll(async () => (await triageOf('9313'))?.score).toBe(90);
  expect((await triageOf('9312'))?.skipReason).toMatch(/^older than/);
  expect(calls().slice(2).every((c) => c === `${PRIMARY} triage`)).toBe(true);
  expect(await quotaDetail()).toBeNull();
});
