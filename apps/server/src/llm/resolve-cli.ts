import { existsSync, readFileSync } from 'node:fs';
import { delimiter, dirname, extname, join, resolve } from 'node:path';
import { err, ok, type Result } from '@xc/shared';

const WINDOWS_EXTS = ['.exe', '.cmd'];

// npm cmd-shims end with: "%dp0%\node_modules\<pkg>\<script>" %*
export function parseCmdShim(content: string, shimDir: string): string | null {
  const matches = [...content.matchAll(/"%(?:~dp0|dp0)%?\\([^"%]+)"/g)];
  const relative = matches[matches.length - 1]?.[1];
  return relative ? resolve(shimDir, relative.replaceAll('\\', '/')) : null;
}

function findInPath(name: string, pathEnv: string, exts: string[]): string | null {
  for (const dir of pathEnv.split(delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const candidate = join(dir, name + ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function argvForShim(shim: string): Result<string[]> {
  const script = parseCmdShim(readFileSync(shim, 'utf8'), dirname(shim));
  if (!script || !existsSync(script)) return err(`cannot resolve npm shim ${shim}`);
  return ok(extname(script).toLowerCase() === '.exe' ? [script] : [process.execPath, script]);
}

export function resolveCli(name: string, pathEnv = process.env.PATH ?? ''): Result<string[]> {
  if (process.platform !== 'win32') {
    const found = findInPath(name, pathEnv, ['']);
    return found ? ok([found]) : err(`${name} not found on PATH`);
  }
  const found = findInPath(name, pathEnv, WINDOWS_EXTS);
  if (!found) return err(`${name} not found on PATH`);
  return extname(found).toLowerCase() === '.cmd' ? argvForShim(found) : ok([found]);
}
