import type { DatabaseSync } from 'node:sqlite';
import type { AppConfig } from '@xc/shared';
import { listAutoPolishCandidates } from '../posts';
import { releaseSlot, reserveSlot } from './daily-cap';
import type { PolishService } from './polish';

// 'stop' on any failure so a broken CLI is not hammered once per candidate; in-flight ones are skipped.
type Outcome = 'done' | 'skipped' | 'stop';

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

  async function polishOne(statusId: string): Promise<Outcome> {
    if (!reserveSlot(db, config.autoPolish.dailyCap, now())) return 'stop';
    const job = polish.request(statusId, 'auto');
    const ok = job.state === 'started' && (await job.done);
    if (!ok) releaseSlot(db, now());
    if (job.state === 'already') return 'skipped';
    return ok ? 'done' : 'stop';
  }

  function nextCandidate(skipped: ReadonlySet<string>): string | null {
    const next = listAutoPolishCandidates(db, config.autoPolish.threshold).find((p) => !skipped.has(p.statusId));
    return next?.statusId ?? null;
  }

  async function run(): Promise<void> {
    if (running || config.autoPolish.dailyCap === 0) return;
    running = true;
    try {
      const skipped = new Set<string>();
      for (let next = nextCandidate(skipped); next !== null; next = nextCandidate(skipped)) {
        const outcome = await polishOne(next);
        if (outcome === 'stop') break;
        if (outcome === 'skipped') skipped.add(next);
      }
    } finally {
      running = false;
    }
  }

  return { run };
}
