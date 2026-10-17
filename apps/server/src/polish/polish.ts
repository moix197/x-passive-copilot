import { log } from '../log';
import type { DatabaseSync } from 'node:sqlite';
import { MAX_DRAFT_VERSIONS, type AppConfig, type PolishReply, type Result, type StoredPost } from '@xc/shared';
import { runClaude } from '../llm/claude';
import { getPost } from '../posts';
import { dataJson, NO_STYLE, renderStyle } from '../triage/prompts';
import { errorClass, withRetry } from '../triage/retry';
import type { Style } from '../voice/select-examples';
import {
  addVersion,
  getDraft,
  listVersionTexts,
  markRegenerating,
  saveDraft,
  settleFailedRegenerate,
  type DraftKind,
} from './drafts-store';
import { checkReply, ruleNames, type Violation } from './guard';

export interface Idea {
  text: string;
  feature: string;
}

export type Subject = { kind: 'post'; post: StoredPost } | { kind: 'idea'; idea: Idea };

export interface GenerateRequest {
  subject: Subject;
  previous: { reply: string; violations: Violation[] } | null;
  /** Earlier versions of this draft; a regenerate must offer something different. */
  alternatives: string[];
}

export type Generate = (request: GenerateRequest) => Promise<Result<PolishReply>>;

export type PolishState = 'started' | 'already' | 'unknown' | 'limit';

export interface PolishJob {
  state: PolishState;
  done: Promise<boolean>;
}

export interface PolishService {
  /** `regenerate` adds a version to a finished draft instead of answering 'already'. */
  request(statusId: string, kind: DraftKind, regenerate?: boolean): PolishJob;
  requestIdea(ideaId: string, idea: Idea): PolishJob;
}

const NOT_STARTED = Promise.resolve(false);
const IDEA_PREFIX = 'idea-';

export function ideaDraftKey(ideaId: string): string {
  return `${IDEA_PREFIX}${ideaId}`;
}

export function isIdeaDraftKey(draftKey: string): boolean {
  return draftKey.startsWith(IDEA_PREFIX);
}

export function replySource(post: StoredPost): string {
  return `${post.text} @${post.authorHandle}`;
}

function sourceOf(subject: Subject): string {
  return subject.kind === 'post' ? replySource(subject.post) : '';
}

function taskBlock(subject: Subject): string {
  if (subject.kind === 'idea') {
    return `Write one standalone X post (not a reply) from this idea.\n<idea>\n${dataJson(subject.idea)}\n</idea>`;
  }
  const { post } = subject;
  const data = {
    author: post.authorHandle,
    text: post.text,
    roughDraft: post.triage?.roughDraft ?? '',
    note: post.triage?.reason ?? '',
  };
  return `Write the final reply to this post.\n<post>\n${dataJson(data)}\n</post>`;
}

function fixBlock(previous: GenerateRequest['previous']): string {
  if (!previous) return '';
  const rejected = {
    previousReply: previous.reply,
    violations: previous.violations.map((v) => `${v.rule}: ${v.detail}`),
  };
  return `Your previous reply was rejected.\n${dataJson(rejected)}\nWrite a new reply that fixes every violation.`;
}

function alternativesBlock(alternatives: string[]): string {
  if (!alternatives.length) return '';
  return `Options already written (write a clearly different one):\n${dataJson(alternatives)}`;
}

export function buildPolishPrompt({ subject, previous, alternatives }: GenerateRequest, style: Style = NO_STYLE): string {
  return [taskBlock(subject), renderStyle(style), alternativesBlock(alternatives), fixBlock(previous)]
    .filter(Boolean)
    .join('\n\n');
}

export function claudeGenerate(config: AppConfig, style: () => Style = () => NO_STYLE): Generate {
  return (request) => runClaude(buildPolishPrompt(request, style()), config.models.final, config.spacehoodRepoPath);
}

function configError(config: AppConfig): string | null {
  if (!config.models.final) return 'config: models.final is not set';
  return config.spacehoodRepoPath ? null : 'config: spacehoodRepoPath is not set';
}

interface Job {
  key: string;
  subject: Subject;
  kind: DraftKind;
  regenerating: boolean;
}

type JobPlan = { ok: false; state: PolishState } | { ok: true; regenerating: boolean; kind: DraftKind | null };

export function createPolishService(
  db: DatabaseSync,
  config: AppConfig,
  generate: Generate,
  now: () => number = Date.now,
): PolishService {
  const inFlight = new Set<string>();

  function save(key: string, kind: DraftKind, fields: Partial<Parameters<typeof saveDraft>[1]>): void {
    saveDraft(db, { statusId: key, kind, status: 'polishing', text: null, violations: [], error: null, ...fields }, now());
  }

  async function attempt(subject: Subject, previous: GenerateRequest['previous'], alternatives: string[]) {
    const reply = await withRetry(() => generate({ subject, previous, alternatives }));
    if (!reply.ok) return reply;
    const violations = checkReply(reply.value.reply, sourceOf(subject));
    return { ok: true as const, value: { reply: reply.value.reply, violations } };
  }

  // Every version goes through the guard, with one regenerate when it fails.
  async function generateChecked(subject: Subject, alternatives: string[]) {
    const first = await attempt(subject, null, alternatives);
    if (!first.ok || first.value.violations.length === 0) return first;
    return attempt(subject, first.value, alternatives);
  }

  // A failed regenerate keeps the selected version and only reports the error.
  function finishFailed(job: Job, problem: string): boolean {
    if (job.regenerating) settleFailedRegenerate(db, job.key, problem);
    else save(job.key, job.kind, { status: 'error', error: problem });
    log(`polish ${job.key} failed: ${problem}`);
    return false;
  }

  async function runJob(job: Job): Promise<boolean> {
    const outcome = await generateChecked(job.subject, listVersionTexts(db, job.key));
    if (!outcome.ok) return finishFailed(job, errorClass(outcome.error));
    const { reply, violations } = outcome.value;
    const status = violations.length ? 'needs_edit' : 'ready';
    const version = { text: reply, status, violations: ruleNames(violations) } as const;
    const selectedVersion = addVersion(db, job.key, version, now());
    save(job.key, job.kind, { ...version, selectedVersion });
    log(`polish ${job.key} ${status}`);
    return true;
  }

  function planJob(key: string, regenerate: boolean): JobPlan {
    const draft = getDraft(db, key);
    if (inFlight.has(key) || draft?.status === 'polishing') return { ok: false, state: 'already' };
    if (!draft || draft.status === 'error') return { ok: true, regenerating: false, kind: null };
    if (!regenerate) return { ok: false, state: 'already' };
    if (listVersionTexts(db, key).length >= MAX_DRAFT_VERSIONS) return { ok: false, state: 'limit' };
    return { ok: true, regenerating: true, kind: draft.kind };
  }

  function start(key: string, subject: Subject, kind: DraftKind, regenerate = false): PolishJob {
    const plan = planJob(key, regenerate);
    if (!plan.ok) return { state: plan.state, done: NOT_STARTED };
    const job: Job = { key, subject, kind: plan.kind ?? kind, regenerating: plan.regenerating };
    inFlight.add(key);
    if (job.regenerating) markRegenerating(db, key);
    else save(key, job.kind, { status: 'polishing' });
    const configProblem = configError(config);
    const run = configProblem ? Promise.resolve(finishFailed(job, configProblem)) : runJob(job);
    const done = run.catch(() => false).finally(() => inFlight.delete(key));
    return { state: 'started', done };
  }

  function request(statusId: string, kind: DraftKind, regenerate = false): PolishJob {
    const post = getPost(db, statusId);
    return post ? start(statusId, { kind: 'post', post }, kind, regenerate) : { state: 'unknown', done: NOT_STARTED };
  }

  function requestIdea(ideaId: string, idea: Idea): PolishJob {
    return start(ideaDraftKey(ideaId), { kind: 'idea', idea }, 'manual');
  }

  return { request, requestIdea };
}
