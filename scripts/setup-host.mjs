import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const HOST_NAME = 'com.xpassivecopilot.host';
const REG_KEY = ['HKCU', 'Software', 'Google', 'Chrome', 'NativeMessagingHosts', HOST_NAME].join('\\');
const UNSAFE_BAT_CHARS = /["%\r\n&|<>^!]/;

export function extensionIdFromKey(base64Key) {
  const hex = createHash('sha256').update(Buffer.from(base64Key, 'base64')).digest('hex').slice(0, 32);
  return [...hex].map((c) => String.fromCharCode('a'.charCodeAt(0) + parseInt(c, 16))).join('');
}

export function buildHostManifest({ extensionId, batPath }) {
  return {
    name: HOST_NAME,
    description: 'X passive copilot local server',
    path: batPath,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${extensionId}/`],
  };
}

export function buildBat({ nodePath, serverPath, home }) {
  for (const p of [nodePath, serverPath, home]) {
    if (UNSAFE_BAT_CHARS.test(p)) throw new Error(`unsupported character in path: ${p}`);
  }
  return `@echo off\r\n"${nodePath}" "${serverPath}" --native --home "${home}"\r\n`;
}

function run(args) {
  execFileSync('reg.exe', args, { shell: false, windowsHide: true, stdio: 'pipe' });
}

function unregister() {
  try {
    run(['delete', REG_KEY, '/f']);
  } catch {
    // key not present
  }
}

function register(manifestPath) {
  run(['add', REG_KEY, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f']);
}

function main(argv) {
  const root = resolve(import.meta.dirname, '..');
  const dryRun = argv.includes('--dry-run');
  const homeFlag = argv.indexOf('--home');
  const home = homeFlag === -1 ? join(homedir(), '.x-passive-copilot') : resolve(argv[homeFlag + 1]);
  if (argv.includes('--unregister')) {
    if (!dryRun) unregister();
    console.log(dryRun ? `would delete ${REG_KEY}` : `removed ${REG_KEY}`);
    return;
  }
  const serverPath = join(root, 'apps/server/dist/server.mjs');
  if (!existsSync(serverPath)) throw new Error('apps/server/dist/server.mjs missing: run `pnpm build` first');
  const { key } = JSON.parse(readFileSync(join(root, 'apps/extension/manifest.json'), 'utf8'));
  const extensionId = extensionIdFromKey(key);
  const hostDir = join(home, 'native-host');
  const batPath = join(hostDir, 'run-host.bat');
  const manifestPath = join(hostDir, `${HOST_NAME}.json`);
  const bat = buildBat({ nodePath: process.execPath, serverPath, home });
  const manifest = buildHostManifest({ extensionId, batPath });
  if (dryRun) {
    console.log(`extension id: ${extensionId}\nregistry: ${REG_KEY}\nmanifest: ${manifestPath}\n${JSON.stringify(manifest, null, 2)}\n${bat}`);
    return;
  }
  mkdirSync(hostDir, { recursive: true });
  writeFileSync(batPath, bat);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  register(manifestPath);
  console.log(`registered ${HOST_NAME} for extension ${extensionId}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2));
