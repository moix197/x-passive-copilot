import { log } from '../log';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { type AppConfig, type MustFlag, type Result, type StoredPost } from '@xc/shared';
import { parseTriageReply, runOpencode, type TriageReply } from '../llm/opencode';
import { listUntriagedPosts } from '../posts';
import { prefilter, rulesFromConfig } from './prefilter';
import type { Style } from '../voice/select-examples';
import { buildTriagePrompt, NO_STYLE } from './prompts';
import { errorClass, safeReason, withRetry } from './retry';
import { saveError, saveResult, saveSkipped } from './triage-store';

const FLUSH_DELAY_MS = 30_000;

export type Classify = (posts: StoredPost[], mustFlag: ReadonlyMap<string, MustFlag>) => Promise<Result<TriageReply>>;

export function readContext(home: string): string {
  try {
    return readFileSync(join(home, 'context.md'), 'utf8');
  } catch {
    return '';
  }
}

export function opencodeClassify(config: AppConfig, home: string, style: () => Style = () => NO_STYLE): Classify {
  return async (posts, mustFlag) => {
    const prompt = buildTriagePrompt(readContext(home), posts, mustFlag, style());
    const reply = await runOpencode(prompt, config.models.triage, home);
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

  async function processBatch(batch: Candidate[]): Promise<void> {
    const flags = new Map(batch.flatMap((c) => (c.mustFlag ? [[c.post.statusId, c.mustFlag] as const] : [])));
    const result = await withRetry(() => classify(batch.map((c) => c.post), flags));
    const ids = batch.map((c) => c.post.statusId).join(',');
    if (result.ok) {
      recordReply(batch, result.value);
      log(`triage batch ${ids} ok`);
      afterBatch();
      return;
    }
    const kind = errorClass(result.error);
    for (const c of batch) saveError(db, c.post.statusId, kind, c.mustFlag, now());
    log(`triage batch ${ids} failed: ${kind} (${safeReason(result.error)})`);
  }

  async function drain(force: boolean): Promise<void> {
    if (running || !config.models.triage) return;
    running = true;
    try {
      for (;;) {
        const pending = collectCandidates();
        if (pending.length === 0 || (pending.length < config.triage.batchSize && !force)) break;
        await processBatch(pending.slice(0, config.triage.batchSize));
      }
    } finally {
      running = false;
    }
    armTimer();
  }

  function armTimer(): void {
    if (timer || !config.models.triage || listUntriagedPosts(db).length === 0) return;
    timer = setTimeout(() => {
      timer = null;
      void drain(true);
    }, FLUSH_DELAY_MS);
  }

  return {
    notify: () => {
      void drain(false);
      armTimer();
    },
    drain,
  };
}

