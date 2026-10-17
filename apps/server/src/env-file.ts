import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ROOT_MARKER = 'pnpm-workspace.yaml';

// Walks up from the running module (apps/server/src or apps/server/dist) to the workspace root.
export function findRepoRoot(startDir: string): string | null {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, ROOT_MARKER))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Loads `<repo root>/.env` into process.env (existing vars win). A missing file is fine. */
export function loadRepoEnv(moduleDir: string, load: (path: string) => void = (p) => process.loadEnvFile(p)): void {
  const root = findRepoRoot(moduleDir);
  if (!root) return;
  const file = join(root, '.env');
  if (existsSync(file)) load(file);
}
