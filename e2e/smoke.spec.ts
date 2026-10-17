// @covers apps/extension/src/content/**, apps/extension/src/background/**, apps/extension/src/panel/**, apps/extension/src/server-config.ts, apps/extension/manifest.json, apps/server/src/**, shared/src/**
import { expect, test, type BrowserContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { authHeader, fakeTwimg, launchExtension, pointExtensionAtServer, removeTempDirs, root, startServer, type TestServer } from './harness';

const fixtureHtml = readFileSync(join(root, 'e2e/fixtures/x-home.html'), 'utf8');

let server: TestServer;
let baseUrl: string;
let context: BrowserContext;

test.beforeAll(async () => {
  // Triage stays disabled (no models.triage), so must-flag posts can only show as pending.
  server = await startServer({ handle: 'e2eowner', watchlist: ['watched'] });
  baseUrl = server.baseUrl;
  context = await launchExtension();
  await fakeTwimg(context);
});

test.afterAll(async () => {
  await context?.close();
  await server?.stop();
  removeTempDirs();
});

test('captures timeline posts passively and lists them in the panel', async () => {
  const extensionId = await pointExtensionAtServer(context, baseUrl);
  await context.route('https://x.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: fixtureHtml }),
  );

  const page = await context.newPage();
  const pageRequests: string[] = [];
  page.on('request', (request) => pageRequests.push(request.url()));
  await page.goto('https://x.com/home');
  await page.evaluate(() => (window as unknown as { __append(n: number): void }).__append(3));

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/panel.html`);
  const rows = panel.getByTestId('post-row');
  const row = (statusId: string) => panel.locator(`[data-status-id="${statusId}"]`);

  for (const id of ['1001', '1002', '1003', '1005', '1006', '3000', '3001', '3002']) {
    await expect(row(id)).toBeVisible({ timeout: 15_000 });
  }
  await expect(rows).toHaveCount(8);
  await expect(row('1004')).toHaveCount(0);

  await expect(row('1002')).toContainText('Bob Quoter');
  await expect(row('1002')).not.toContainText('Quoted inner text');
  await expect(row('1002')).toContainText('quote');
  await expect(row('1003')).toContainText('reply');
  const stored = await (await fetch(`${baseUrl}/v1/posts?limit=100`, { headers: authHeader })).json();
  const reply = (stored.posts as { statusId: string; replyTo: string[] }[]).find((p) => p.statusId === '1003');
  expect(reply?.replyTo).toEqual(['alice']);
  await expect(row('1001')).toContainText('1200 views');
  await expect(row('1006')).toContainText('1449 views');
  await expect(row('1005')).toContainText('<img src=x onerror=alert(1)>');
  await expect(panel.locator('img:not([data-testid="avatar"])')).toHaveCount(0);
  await expect(row('1001').getByTestId('post-time-link')).toHaveAttribute('href', 'https://x.com/alice/status/1001');
  await expect(row('1001').getByTestId('avatar')).toHaveAttribute('src', 'https://pbs.twimg.com/profile_images/1/alice_normal.png');
  // The quoted author's avatar never leaks into the outer post.
  await expect(row('1002').getByTestId('avatar')).toHaveCount(0);
  await expect(row('1002').getByTestId('avatar-initials')).toHaveText('BQ');

  expect(pageRequests.filter((url) => url.includes('127.0.0.1'))).toEqual([]);
});

test('rejects requests without the token', async () => {
  expect((await fetch(`${baseUrl}/v1/health`)).status).toBe(401);
  expect((await fetch(`${baseUrl}/v1/posts`)).status).toBe(401);
});

test('re-sent posts never duplicate on the server', async () => {
  const body = await (await fetch(`${baseUrl}/v1/posts?limit=100`, { headers: authHeader })).json();
  const ids = (body.posts as { statusId: string }[]).map((p) => p.statusId);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids).not.toContain('1004');

  const post = { ...body.posts[0], statusId: '9999' };
  const send = () =>
    fetch(`${baseUrl}/v1/posts`, { method: 'POST', headers: authHeader, body: JSON.stringify({ posts: [post] }) }).then((r) => r.json());
  expect(await send()).toEqual({ accepted: 1, duplicates: 0 });
  expect(await send()).toEqual({ accepted: 0, duplicates: 1 });
});

test('old watchlist and mention posts never show in Flagged, fresh ones do', async () => {
  const base = { authorName: 'N', text: 'plain post', isReply: false, replyTo: [], quotedStatusId: null,
    metrics: { replies: 0, reposts: 0, likes: 0, views: 0 } };
  const ago = (hours: number) => new Date(Date.now() - hours * 3600_000).toISOString();
  const posts = [
    { ...base, statusId: '8001', authorHandle: 'watched', postedAt: ago(24 * 40) },
    { ...base, statusId: '8002', authorHandle: 'watched', postedAt: ago(25) },
    { ...base, statusId: '8003', authorHandle: 'watched', postedAt: ago(23) },
    { ...base, statusId: '8004', authorHandle: 'someone', text: 'hi @e2eowner', postedAt: ago(73) },
    { ...base, statusId: '8005', authorHandle: 'someone', text: 'hi @e2eowner', postedAt: ago(71) },
  ];
  const sent = await fetch(`${baseUrl}/v1/posts`, { method: 'POST', headers: authHeader, body: JSON.stringify({ posts }) });
  expect(sent.ok).toBe(true);
  const flagged = await (await fetch(`${baseUrl}/v1/posts?view=flagged&limit=50`, { headers: authHeader })).json();
  const ids = (flagged.posts as { statusId: string }[]).map((p) => p.statusId);
  expect(ids).toEqual(expect.arrayContaining(['8003', '8005']));
  for (const stale of ['8001', '8002', '8004']) expect(ids).not.toContain(stale);
});

test('mention and watchlist posts show in Flagged as pending before any triage', async () => {
  const base = { authorName: 'N', text: 'plain post', postedAt: null, isReply: false, replyTo: [], quotedStatusId: null,
    metrics: { replies: 0, reposts: 0, likes: 0, views: 0 } };
  const posts = [
    { ...base, statusId: '7001', authorHandle: 'someone', text: 'hey @e2eowner what do you think?' },
    { ...base, statusId: '7002', authorHandle: 'watched' },
    { ...base, statusId: '7003', authorHandle: 'random' },
  ];
  const sent = await fetch(`${baseUrl}/v1/posts`, { method: 'POST', headers: authHeader, body: JSON.stringify({ posts }) });
  expect(sent.ok).toBe(true);
  const flagged = await (await fetch(`${baseUrl}/v1/posts?view=flagged&limit=50`, { headers: authHeader })).json();
  const byId = new Map((flagged.posts as { statusId: string; triage: { mustFlag: string } | null }[]).map((p) => [p.statusId, p]));
  expect(byId.get('7001')?.triage?.mustFlag).toBe('mention');
  expect(byId.get('7002')?.triage?.mustFlag).toBe('watchlist');
  expect(byId.has('7003')).toBe(false);

  const extensionId = await pointExtensionAtServer(context, baseUrl);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/panel.html`);
  await panel.getByRole('tab', { name: 'Flagged' }).click();
  const row = panel.locator('[data-status-id="7001"]');
  await expect(row).toContainText('mention', { timeout: 15_000 });
  await expect(row).toContainText('triage pending');
});
