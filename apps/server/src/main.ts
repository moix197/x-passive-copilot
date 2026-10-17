import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '@xc/shared';
import { openDb } from './db';
import { prunePosts } from './posts';
import { createRouter } from './router';
import { createTriageService, opencodeClassify } from './triage/triage';

interface CliOptions {
  dev: boolean;
  port: number;
  home: string;
}

function parseArgs(argv: string[]): CliOptions {
  const value = (flag: string) => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  return {
    dev: argv.includes('--dev'),
    port: Number(value('--port') ?? 7457),
    home: value('--home') ?? join(homedir(), '.x-passive-copilot'),
  };
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const config = loadConfig(opts.home);
  if (!config.ok) {
    console.error(config.error);
    process.exit(1);
  }
  const db = openDb(opts.home);
  prunePosts(db, Date.now());
  const triage = createTriageService(db, config.value, opencodeClassify(config.value, opts.home));
  if (!config.value.models.triage) console.log('triage disabled: set models.triage in config.json');
  triage.notify();
  createServer(createRouter(db, { onIngest: triage.notify })).listen(opts.port, '127.0.0.1', () => {
    console.log(`server listening on 127.0.0.1:${opts.port}${opts.dev ? ' (dev)' : ''}`);
  });
}

main();
