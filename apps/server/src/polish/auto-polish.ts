import type { DatabaseSync } from 'node:sqlite';
import type { AppConfig } from '@xc/shared';
import { listAutoPolishCandidates } from '../posts';
import { releaseSlot, reserveSlot } from './daily-cap';
import type { PolishService } from './polish';

export interface AutoPolish {
  run(): Promise<void>;
}

export function createAutoPolish(
  db: DatabaseSync,
  config: AppConfig,
  polish: PolishService,
  now: () => number = Date.now,
): AutoPolish {
  let running = false;

  // Stops the loop on any failure so a broken CLI is not hammered once per candidate.
  async function polishOne(statusId: string): Promise<boolean> {
    if (!reserveSlot(db, config.autoPolish.dailyCap, now())) return false;
    const job = polish.request(statusId, 'auto');
    const ok = job.state === 'started' && (await job.done);
    if (!ok) releaseSlot(db, now());
    return ok;
  }

  async function run(): Promise<void> {
    if (running || config.autoPolish.dailyCap === 0) return;
    running = true;
    try {
      for (;;) {
        const next = listAutoPolishCandidates(db, config.autoPolish.threshold)[0];
        if (!next || !(await polishOne(next.statusId))) break;
      }
    } finally {
      running = false;
    }
  }

  return { run };
}
