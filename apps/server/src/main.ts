import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '@xc/shared';
import { startApp } from './app';
import { createToken, devTokenFromEnv } from './auth';
import { log } from './log';
import { runNativeHost } from './native';

interface CliOptions {
  dev: boolean;
  native: boolean;
  port: number | null;
  home: string;
}

function parseArgs(argv: string[]): CliOptions {
  const value = (flag: string) => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  const port = value('--port');
  return {
    dev: argv.includes('--dev'),
    native: argv.includes('--native'),
    port: port === undefined ? null : Number(port),
    home: value('--home') ?? join(homedir(), '.x-passive-copilot'),
  };
}

function startNative(opts: CliOptions): Promise<void> {
  const start = async (token: string) => {
    const config = loadConfig(opts.home);
    if (!config.ok) throw new Error(config.error);
    return startApp({ home: opts.home, port: opts.port ?? 0, token, config: config.value });
  };
  return runNativeHost({ home: opts.home, start, createToken });
}

async function startDev(opts: CliOptions): Promise<void> {
  const token = devTokenFromEnv(process.env);
  if (!token) {
    log('--dev requires XC_DEV_TOKEN (16-128 chars of A-Z a-z 0-9 _ -)');
    process.exit(1);
  }
  const config = loadConfig(opts.home);
  if (!config.ok) {
    log(config.error);
    process.exit(1);
  }
  const app = await startApp({ home: opts.home, port: opts.port ?? 7457, token, config: config.value });
  log(`dev server on 127.0.0.1:${app.port}`);
}

const opts = parseArgs(process.argv.slice(2));
if (opts.native === opts.dev) {
  log('pass exactly one of --native or --dev');
  process.exit(1);
}
await (opts.native ? startNative(opts) : startDev(opts));
