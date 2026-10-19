import { log } from '../log';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { type AppConfig, type MustFlag, type Result, type StoredPost } from '@xc/shared';
import { parseTriageReply, type TriageReply } from '../llm/opencode';
import { listUntriagedPosts } from '../posts';
import { prefilter, rulesFromConfig } from './prefilter';
import type { Style } from '../voice/select-examples';
import { buildTriagePrompt, NO_STYLE } from './prompts';
import type { RunModel } from '../voice/voice';
import { classifyFailure, errorClass, safeReason, withRetry } from './retry';
import { saveError, saveResult, saveSkipped } from './triage-store';

const FLUSH_DELAY_MS = 30_000;
const PAUSE_SLACK_MS = 1000;

export type Classify = (posts: StoredPost[], mustFlag: ReadonlyMap<string, MustFlag>) => Promise<Result<TriageReply>>;

export function readContext(home: string): string {
  try {
    return readFileSync(join(home, 'context.md'), 'utf8');
  } catch {
    return '';
  }
}

export function opencodeClassify(config: AppConfig, home: string, runModel: RunModel, style: () => Style = () => NO_STYLE): Classify {
  return async (posts, mustFlag) => {
    const prompt = buildTriagePrompt(readContext(home), posts, mustFlag, config.product.name, style());
    const reply = await runModel(prompt);
    if (!reply.ok) return reply;
    return parseTriageReply(reply.value, new Set(posts.map((p) => p.statusId)));
  };
}

export interface TriageService {
  notify(): void;
  drain(force: boolean): Promise<void>;
}

interface Candidate {
  post: StoredPost;
  mustFlag: MustFlag | null;
}

export function createTriageService(
  db: DatabaseSync,
  config: AppConfig,
  classify: Classify,
  now: () => number = Date.now,
  afterBatch: () => void = () => undefined,
  /** When the model pool is out of quota on every model (0 = usable). */
  pausedUntil: () => number = () => 0,
): TriageService {
  let running = false;
  let timer: NodeJS.Timeout | null = null;

  function collectCandidates(): Candidate[] {
    const rules = rulesFromConfig(config);
    const candidates: Candidate[] = [];
    for (const post of listUntriagedPosts(db)) {
      const verdict = prefilter(post, rules, now());
      if (verdict.action === 'skip') saveSkipped(db, post.statusId, verdict.reason, now());
      else candidates.push({ post, mustFlag: verdict.mustFlag ?? null });
    }
    return candidates;
  }

  function recordReply(batch: Candidate[], reply: TriageReply): void {
    const flags = new Map(batch.map((c) => [c.post.statusId, c.mustFlag]));
    const handled = new Set<string>();
    for (const item of reply.items) {
      saveResult(db, item, flags.get(item.statusId) ?? null, now());
      handled.add(item.statusId);
    }
    for (const c of batch) {
      if (handled.has(c.post.statusId)) continue;
      const reason = reply.invalidIds.includes(c.post.statusId) ? 'malformed output' : 'no result';
      saveError(db, c.post.statusId, reason, c.mustFlag, now());
    }
  }

  // Returns false when the batch hit a quota pause: its posts stay untriaged for the next drain.
  async function processBatch(batch: Candidate[]): Promise<boolean> {
    const flags = new Map(batch.flatMap((c) => (c.mustFlag ? [[c.post.statusId, c.mustFlag] as const] : [])));
    const result = await withRetry(() => classify(batch.map((c) => c.post), flags));
    const ids = batch.map((c) => c.post.statusId).join(',');
    if (result.ok) {
      recordReply(batch, result.value);
      log(`triage batch ${ids} ok`);
      afterBatch();
      return true;
    }
    if (classifyFailure(result.error) === 'paused') {
      log(`triage paused until ${new Date(pausedUntil()).toISOString()}: ${batch.length} posts wait (${safeReason(result.error)})`);
      return false;
    }
    const kind = errorClass(result.error);
    for (const c of batch) saveError(db, c.post.statusId, kind, c.mustFlag, now());
    log(`triage batch ${ids} failed: ${kind} (${safeReason(result.error)})`);
    return true;
  }

  const isPaused = () => pausedUntil() > now();

  async function drain(force: boolean): Promise<void> {
    if (running || !config.models.triage) return;
    running = true;
    try {
      for (;;) {
        const pending = collectCandidates();
        if (isPaused() || pending.length === 0 || (pending.length < config.triage.batchSize && !force)) break;
        if (!(await processBatch(pending.slice(0, config.triage.batchSize)))) break;
      }
    } finally {
      running = false;
    }
    armTimer();
  }

  // While paused the timer waits for the earliest quota reset; the backlog (re-prefiltered, so posts
  // past their age limit are skipped) is drained then.
  function armTimer(): void {
    if (!config.models.triage || listUntriagedPosts(db).length === 0) return;
    // A pause replaces a pending flush timer, which may have been armed before the pause began.
    if (isPaused()) return schedule(pausedUntil() - now() + PAUSE_SLACK_MS);
    if (!timer) schedule(FLUSH_DELAY_MS);
  }

  function schedule(delay: number): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void drain(true);
    }, delay);
  }

  return {
    notify: () => {
      void drain(false);
      armTimer();
    },
    drain,
  };
}

