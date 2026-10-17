import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Explicit names stay alongside "*" in case a CLI version ignores the wildcard; "*" also covers
// MCP tools inherited from the user's global opencode config.
const DENIED_TOOLS = [
  'bash', 'edit', 'write', 'read', 'grep', 'glob', 'list', 'patch',
  'webfetch', 'websearch', 'codesearch', 'todowrite', 'todoread', 'task', 'lsp', 'skill',
];

const DENIED_PERMISSIONS = [
  'edit', 'bash', 'webfetch', 'read', 'glob', 'grep', 'list', 'task', 'websearch', 'codesearch',
  'lsp', 'skill', 'todowrite', 'todoread', 'external_directory', 'doom_loop',
];

const OPENCODE_SANDBOX_CONFIG = {
  $schema: 'https://opencode.ai/config.json',
  autoupdate: false,
  share: 'disabled',
  mcp: {},
  tools: { '*': false, ...Object.fromEntries(DENIED_TOOLS.map((tool) => [tool, false])) },
  permission: { '*': 'deny', ...Object.fromEntries(DENIED_PERMISSIONS.map((perm) => [perm, 'deny'])) },
};

export function opencodeSandboxDir(home: string): string {
  return join(home, 'sandbox', 'opencode');
}

export function ensureOpencodeSandbox(home: string): string {
  const dir = opencodeSandboxDir(home);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'opencode.json');
  const wanted = `${JSON.stringify(OPENCODE_SANDBOX_CONFIG, null, 2)}\n`;
  let current = '';
  try {
    current = readFileSync(file, 'utf8');
  } catch {
    // first run
  }
  if (current !== wanted) writeFileSync(file, wanted);
  return dir;
}
