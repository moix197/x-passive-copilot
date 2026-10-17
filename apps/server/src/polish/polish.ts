import { log } from '../log';
import type { DatabaseSync } from 'node:sqlite';
import { type AppConfig, type PolishReply, type Result, type StoredPost } from '@xc/shared';
import { runClaude } from '../llm/claude';
import { getPost } from '../posts';
import { dataJson, NO_STYLE, renderStyle } from '../triage/prompts';
import { errorClass, withRetry } from '../triage/retry';
import type { Style } from '../voice/select-examples';
import { getDraftStatus, saveDraft, type DraftKind } from './drafts-store';
import { checkReply, ruleNames, type Violation } from './guard';

export interface Idea {
  text: string;
  feature: string;
}

export type Subject = { kind: 'post'; post: StoredPost } | { kind: 'idea'; idea: Idea };

export interface GenerateRequest {
  subject: Subject;
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
  return `Your previous reply was rejected.\n${JSON.stringify(rejected)}\nWrite a new reply that fixes every violation.`;
}

export function buildPolishPrompt({ subject, previous }: GenerateRequest, style: Style = NO_STYLE): string {
  return [taskBlock(subject), renderStyle(style), fixBlock(previous)].filter(Boolean).join('\n\n');
}

export function claudeGenerate(config: AppConfig, style: () => Style = () => NO_STYLE): Generate {
  return (request) => runClaude(buildPolishPrompt(request, style()), config.models.final, config.spacehoodRepoPath);
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

  function save(key: string, kind: DraftKind, fields: Partial<Parameters<typeof saveDraft>[1]>): void {
    saveDraft(db, { statusId: key, kind, status: 'polishing', text: null, violations: [], error: null, ...fields }, now());
  }

  async function attempt(subject: Subject, previous: GenerateRequest['previous']) {
    const reply = await withRetry(() => generate({ subject, previous }));
    if (!reply.ok) return reply;
    const violations = checkReply(reply.value.reply, sourceOf(subject));
    return { ok: true as const, value: { reply: reply.value.reply, violations } };
  }

  async function generateChecked(subject: Subject) {
    const first = await attempt(subject, null);
    if (!first.ok || first.value.violations.length === 0) return first;
    return attempt(subject, first.value);
  }

  async function runJob(key: string, subject: Subject, kind: DraftKind): Promise<boolean> {
    const outcome = await generateChecked(subject);
    if (!outcome.ok) {
      const kindOfError = errorClass(outcome.error);
      save(key, kind, { status: 'error', error: kindOfError });
      log(`polish ${key} failed: ${kindOfError}`);
      return false;
    }
    const { reply, violations } = outcome.value;
    const status = violations.length ? 'needs_edit' : 'ready';
    save(key, kind, { status, text: reply, violations: ruleNames(violations) });
    log(`polish ${key} ${status}`);
    return true;
  }

  async function failFast(key: string, kind: DraftKind, problem: string): Promise<boolean> {
    save(key, kind, { status: 'error', error: problem });
    return false;
  }

  function start(key: string, subject: Subject, kind: DraftKind): PolishJob {
    const existing = getDraftStatus(db, key);
    if (inFlight.has(key) || (existing !== null && existing !== 'error')) {
      return { state: 'already', done: NOT_STARTED };
    }
    const configProblem = configError(config);
    inFlight.add(key);
    save(key, kind, { status: 'polishing' });
    const run = configProblem ? failFast(key, kind, configProblem) : runJob(key, subject, kind);
    const done = run.catch(() => false).finally(() => inFlight.delete(key));
    return { state: 'started', done };
  }

  function request(statusId: string, kind: DraftKind): PolishJob {
    const post = getPost(db, statusId);
    return post ? start(statusId, { kind: 'post', post }, kind) : { state: 'unknown', done: NOT_STARTED };
  }

  function requestIdea(ideaId: string, idea: Idea): PolishJob {
    return start(ideaDraftKey(ideaId), { kind: 'idea', idea }, 'manual');
  }

  return { request, requestIdea };
}
