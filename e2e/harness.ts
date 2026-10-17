import { chromium, expect, type BrowserContext } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

export const root = resolve(import.meta.dirname, '..');
const extensionDir = join(root, 'apps/extension/dist');
const devToken = 'e2e-dev-token-0123456789';
export const authHeader = { authorization: `Bearer ${devToken}` };

const tempDirs: string[] = [];

export function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

export function removeTempDirs(): void {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
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

export interface TestServer {
  baseUrl: string;
  stop(): Promise<void>;
}

export async function startServer(config: object, env: NodeJS.ProcessEnv = {}): Promise<TestServer> {
  const port = await findFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const home = makeTempDir('xc-home-');
  writeFileSync(join(home, 'config.json'), JSON.stringify(config));
  const args = ['--import', 'tsx', 'apps/server/src/main.ts', '--dev', '--port', String(port), '--home', home];
  const server: ChildProcess = spawn(process.execPath, args, {
    cwd: root,
    env: { ...process.env, ...env, XC_DEV_TOKEN: devToken },
    stdio: 'ignore',
  });
  await expect
    .poll(() => fetch(`${baseUrl}/v1/health`, { headers: authHeader }).then((r) => r.ok, () => false), { timeout: 20_000 })
    .toBe(true);
  const stop = async () => {
    if (server.exitCode !== null) return;
    const exited = new Promise((done) => server.once('exit', done));
    server.kill();
    await exited;
  };
  return { baseUrl, stop };
}

export function launchExtension(): Promise<BrowserContext> {
  return chromium.launchPersistentContext(makeTempDir('xc-profile-'), {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
  });
}

export async function pointExtensionAtServer(ctx: BrowserContext, baseUrl: string): Promise<string> {
  const worker = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  await worker.evaluate((serverUrl) => chrome.storage.local.set({ serverUrl }), baseUrl);
  await worker.evaluate((token) => chrome.storage.session.set({ token }), devToken);
  return new URL(worker.url()).host;
}

export function postJson(baseUrl: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { method: 'POST', headers: authHeader, body: JSON.stringify(body) });
}

// 1x1 PNG standing in for X's image CDN, so avatars never hit the network.
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

export function fakeTwimg(ctx: BrowserContext): Promise<void> {
  return ctx.route('https://pbs.twimg.com/**', (route) => route.fulfill({ contentType: 'image/png', body: PIXEL }));
}

/** Puts fake `claude` / `opencode` CLIs (e2e/fakes) first on PATH, the way npm installs real ones. */
export function installFakeClis(): { binDir: string; env: NodeJS.ProcessEnv } {
  const binDir = makeTempDir('xc-bin-');
  for (const name of ['claude', 'opencode']) {
    copyFileSync(join(root, 'e2e/fakes', `${name}.mjs`), join(binDir, `${name}.mjs`));
    if (process.platform === 'win32') {
      writeFileSync(join(binDir, `${name}.cmd`), `@"%~dp0\\${name}.mjs" %*\r\n`);
    } else {
      writeFileSync(join(binDir, name), `#!/bin/sh\nexec node "$(dirname "$0")/${name}.mjs" "$@"\n`, { mode: 0o755 });
    }
  }
  const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  return { binDir, env: { [pathKey]: `${binDir}${delimiter}${process.env[pathKey] ?? ''}` } };
}
