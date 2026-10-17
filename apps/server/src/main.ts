import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '@xc/shared';
import { openDb } from './db';
import { createAutoPolish } from './polish/auto-polish';
import { remainingSlots } from './polish/daily-cap';
import { clearStalePolishing } from './polish/drafts-store';
import { claudeGenerate, createPolishService } from './polish/polish';
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
  clearStalePolishing(db);
  const polish = createPolishService(db, config.value, claudeGenerate(config.value));
  const autoPolish = createAutoPolish(db, config.value, polish);
  const triage = createTriageService(
    db, config.value, opencodeClassify(config.value, opts.home), Date.now, () => void autoPolish.run(),
  );
  if (!config.value.models.triage) console.log('triage disabled: set models.triage in config.json');
  triage.notify();
  const hooks = {
    onIngest: triage.notify,
    onPolish: (statusId: string) => polish.request(statusId, 'manual').state,
    polishContext: () => ({
      threshold: config.value.autoPolish.threshold,
      capReached:
        config.value.autoPolish.dailyCap > 0 && remainingSlots(db, config.value.autoPolish.dailyCap, Date.now()) === 0,
    }),
  };
  createServer(createRouter(db, hooks)).listen(opts.port, '127.0.0.1', () => {
    console.log(`server listening on 127.0.0.1:${opts.port}${opts.dev ? ' (dev)' : ''}`);
  });
}

main();
