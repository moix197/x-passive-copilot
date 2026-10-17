import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Explicit names stay alongside "*" in case a CLI version ignores the wildcard; "*" also covers
// MCP tools inherited from the user's global opencode config.
const DENIED_TOOLS = [
  'bash', 'edit', 'write', 'grep', 'glob', 'list', 'patch',
  'webfetch', 'websearch', 'codesearch', 'todowrite', 'todoread', 'task', 'lsp', 'skill',
];

const DENIED_PERMISSIONS = [
  'edit', 'bash', 'webfetch', 'glob', 'grep', 'list', 'task', 'websearch', 'codesearch',
  'lsp', 'skill', 'todowrite', 'todoread', 'external_directory', 'doom_loop',
];

// opencode's free-tier gateway rejects (403 FreeTierError) requests whose tool list lacks `read`,
// and a fully denied permission drops the tool. So `read` stays offered, but every path is denied
// except a filename that never exists (verified against opencode 1.19.3).
const UNREADABLE_SENTINEL = 'xc-no-such-file.never';

const OPENCODE_SANDBOX_CONFIG = {
  $schema: 'https://opencode.ai/config.json',
  autoupdate: false,
  share: 'disabled',
  mcp: {},
  tools: { '*': false, ...Object.fromEntries(DENIED_TOOLS.map((tool) => [tool, false])), read: true },
  permission: {
    '*': 'deny',
    ...Object.fromEntries(DENIED_PERMISSIONS.map((perm) => [perm, 'deny'])),
    read: { '*': 'deny', [UNREADABLE_SENTINEL]: 'allow' },
  },
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
