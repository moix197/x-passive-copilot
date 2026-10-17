import { log } from '../log';
import type { DatabaseSync } from 'node:sqlite';
import { type AppConfig, type PolishReply, type Result, type StoredPost } from '@xc/shared';
import { runClaude } from '../llm/claude';
import { getPost } from '../posts';
import { errorClass, withRetry } from '../triage/retry';
import { getDraftStatus, saveDraft, type DraftKind } from './drafts-store';
import { checkReply, ruleNames, type Violation } from './guard';

export interface GenerateRequest {
  post: StoredPost;
  previous: { reply: string; violations: Violation[] } | null;
}

export type Generate = (request: GenerateRequest) => Promise<Result<PolishReply>>;

export type PolishState = 'started' | 'already' | 'unknown';

export interface PolishJob {
  state: PolishState;
  done: Promise<boolean>;
}

export interface PolishService {
  request(statusId: string, kind: DraftKind): PolishJob;
}

const NOT_STARTED = Promise.resolve(false);

export function buildPolishPrompt({ post, previous }: GenerateRequest): string {
  const data = {
    author: post.authorHandle,
    text: post.text,
    roughDraft: post.triage?.roughDraft ?? '',
    note: post.triage?.reason ?? '',
  };
  const fix = previous
    ? `\nYour previous reply was rejected.\n${JSON.stringify({
        previousReply: previous.reply,
        violations: previous.violations.map((v) => `${v.rule}: ${v.detail}`),
      })}\nWrite a new reply that fixes every violation.`
    : '';
  return `Write the final reply to this post.\n<post>\n${JSON.stringify(data).replaceAll('<', '\\u003c')}\n</post>${fix}`;
}

export function claudeGenerate(config: AppConfig): Generate {
  return (request) => runClaude(buildPolishPrompt(request), config.models.final, config.spacehoodRepoPath);
}

function sourceOf(post: StoredPost): string {
  return `${post.text} @${post.authorHandle}`;
}

function configError(config: AppConfig): string | null {
  if (!config.models.final) return 'config: models.final is not set';
  return config.spacehoodRepoPath ? null : 'config: spacehoodRepoPath is not set';
}

export function createPolishService(
  db: DatabaseSync,
  config: AppConfig,
  generate: Generate,
  now: () => number = Date.now,
): PolishService {
  const inFlight = new Set<string>();

  function save(statusId: string, kind: DraftKind, fields: Partial<Parameters<typeof saveDraft>[1]>): void {
    saveDraft(db, { statusId, kind, status: 'polishing', text: null, violations: [], error: null, ...fields }, now());
  }

  async function attempt(post: StoredPost, previous: GenerateRequest['previous']) {
    const reply = await withRetry(() => generate({ post, previous }));
    if (!reply.ok) return reply;
    return { ok: true as const, value: { reply: reply.value.reply, violations: checkReply(reply.value.reply, sourceOf(post)) } };
  }

  async function generateChecked(post: StoredPost) {
    const first = await attempt(post, null);
    if (!first.ok || first.value.violations.length === 0) return first;
    return attempt(post, first.value);
  }

  async function runJob(post: StoredPost, kind: DraftKind): Promise<boolean> {
    const id = post.statusId;
    const outcome = await generateChecked(post);
    if (!outcome.ok) {
      const kindOfError = errorClass(outcome.error);
      save(id, kind, { status: 'error', error: kindOfError });
      log(`polish ${id} failed: ${kindOfError}`);
      return false;
    }
    const { reply, violations } = outcome.value;
    const status = violations.length ? 'needs_edit' : 'ready';
    save(id, kind, { status, text: reply, violations: ruleNames(violations) });
    log(`polish ${id} ${status}`);
    return true;
  }

  function request(statusId: string, kind: DraftKind): PolishJob {
    const post = getPost(db, statusId);
    if (!post) return { state: 'unknown', done: NOT_STARTED };
    const existing = getDraftStatus(db, statusId);
    if (inFlight.has(statusId) || (existing !== null && existing !== 'error')) {
      return { state: 'already', done: NOT_STARTED };
    }
    const configProblem = configError(config);
    inFlight.add(statusId);
    save(statusId, kind, { status: 'polishing' });
    const run = configProblem ? failFast(statusId, kind, configProblem) : runJob(post, kind);
    const done = run.catch(() => false).finally(() => inFlight.delete(statusId));
    return { state: 'started', done };
  }

  async function failFast(statusId: string, kind: DraftKind, problem: string): Promise<boolean> {
    save(statusId, kind, { status: 'error', error: problem });
    return false;
  }

  return { request };
}
