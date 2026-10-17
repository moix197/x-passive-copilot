import { chromium, expect, test, type BrowserContext } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const extensionDir = join(root, 'apps/extension/dist');
const fixtureHtml = readFileSync(join(root, 'e2e/fixtures/x-home.html'), 'utf8');

let server: ChildProcess;
let baseUrl: string;
let context: BrowserContext;
const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function findFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolvePort(port));
    });
  });
}

async function startServer(): Promise<void> {
  const port = await findFreePort();
  baseUrl = `http://127.0.0.1:${port}`;
  const args = ['--import', 'tsx', 'apps/server/src/main.ts', '--dev', '--port', String(port)];
  server = spawn(process.execPath, [...args, '--home', makeTempDir('xc-home-')], {
    cwd: root,
    stdio: 'ignore',
  });
  await expect
    .poll(() => fetch(`${baseUrl}/v1/health`).then((r) => r.ok, () => false), { timeout: 20_000 })
    .toBe(true);
}

async function stopServer(): Promise<void> {
  if (!server || server.exitCode !== null) return;
  const exited = new Promise((done) => server.once('exit', done));
  server.kill();
  await exited;
}

async function launchExtension(): Promise<BrowserContext> {
  return chromium.launchPersistentContext(makeTempDir('xc-profile-'), {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
  });
}

async function pointExtensionAtServer(ctx: BrowserContext): Promise<string> {
  const worker = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  await worker.evaluate((serverUrl) => chrome.storage.local.set({ serverUrl }), baseUrl);
  return new URL(worker.url()).host;
}

test.beforeAll(async () => {
  await startServer();
  context = await launchExtension();
});

test.afterAll(async () => {
  await context?.close();
  await stopServer();
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

test('captures timeline posts passively and lists them in the panel', async () => {
  const extensionId = await pointExtensionAtServer(context);
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
  await expect(row('1001')).toContainText('1200 views');
  await expect(row('1006')).toContainText('1449 views');
  await expect(row('1005')).toContainText('<img src=x onerror=alert(1)>');
  await expect(panel.locator('img')).toHaveCount(0);
  await expect(row('1001').getByRole('link', { name: 'Open on X' })).toHaveAttribute(
    'href',
    'https://x.com/alice/status/1001',
  );

  expect(pageRequests.filter((url) => url.includes('127.0.0.1'))).toEqual([]);
});

test('re-sent posts never duplicate on the server', async () => {
  const body = await (await fetch(`${baseUrl}/v1/posts?limit=100`)).json();
  const ids = (body.posts as { statusId: string }[]).map((p) => p.statusId);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids).not.toContain('1004');

  const post = { ...body.posts[0], statusId: '9999' };
  const send = () =>
    fetch(`${baseUrl}/v1/posts`, { method: 'POST', body: JSON.stringify({ posts: [post] }) }).then((r) => r.json());
  expect(await send()).toEqual({ accepted: 1, duplicates: 0 });
  expect(await send()).toEqual({ accepted: 0, duplicates: 1 });
});
