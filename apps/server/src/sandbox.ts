import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DENIED_TOOLS = [
  'bash', 'edit', 'write', 'read', 'grep', 'glob', 'list', 'patch',
  'webfetch', 'todowrite', 'todoread', 'task',
];

const SANDBOX_CONFIG = {
  $schema: 'https://opencode.ai/config.json',
  autoupdate: false,
  share: 'disabled',
  tools: Object.fromEntries(DENIED_TOOLS.map((tool) => [tool, false])),
  permission: { edit: 'deny', bash: 'deny', webfetch: 'deny' },
};

export function opencodeSandboxDir(home: string): string {
  return join(home, 'sandbox', 'opencode');
}

export function ensureOpencodeSandbox(home: string): string {
  const dir = opencodeSandboxDir(home);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'opencode.json');
  const wanted = `${JSON.stringify(SANDBOX_CONFIG, null, 2)}\n`;
  let current = '';
  try {
    current = readFileSync(file, 'utf8');
  } catch {
    // first run
  }
  if (current !== wanted) writeFileSync(file, wanted);
  return dir;
}
