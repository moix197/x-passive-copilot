import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCmdShim } from './resolve-cli';

const shim = [
  '@ECHO off',
  'SETLOCAL',
  'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\opencode-ai\\bin\\opencode" %*',
].join('\r\n');

describe('parseCmdShim', () => {
  it('resolves the script path relative to the shim dir', () => {
    const dir = resolve('some', 'npm');
    expect(parseCmdShim(shim, dir)).toBe(resolve(dir, 'node_modules/opencode-ai/bin/opencode'));
  });

  it('returns null when no script is referenced', () => {
    expect(parseCmdShim('@echo off', resolve('x'))).toBeNull();
  });
});
