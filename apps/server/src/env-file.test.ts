import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findRepoRoot, loadRepoEnv } from './env-file';

function fakeRepo(withEnv: boolean): { root: string; moduleDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'xc-envfile-'));
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
  if (withEnv) writeFileSync(join(root, '.env'), 'GEMINI_API_KEY=x\n');
  const moduleDir = join(root, 'apps', 'server', 'dist');
  mkdirSync(moduleDir, { recursive: true });
  return { root, moduleDir };
}

describe('env-file', () => {
  it('finds the workspace root from a nested dir and loads its .env', () => {
    const { root, moduleDir } = fakeRepo(true);
    expect(findRepoRoot(moduleDir)).toBe(root);
    const loaded: string[] = [];
    loadRepoEnv(moduleDir, (p) => loaded.push(p));
    expect(loaded).toEqual([join(root, '.env')]);
  });

  it('does nothing when there is no .env or no repo root', () => {
    const loaded: string[] = [];
    loadRepoEnv(fakeRepo(false).moduleDir, (p) => loaded.push(p));
    loadRepoEnv(mkdtempSync(join(tmpdir(), 'xc-noroot-')), (p) => loaded.push(p));
    expect(loaded).toEqual([]);
  });
});
