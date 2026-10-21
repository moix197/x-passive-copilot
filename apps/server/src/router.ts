import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import {
  FLAGGED_FEEDS,
  MAX_INLINE_IDS,
  FeedbackRequestSchema,
  RepliedRequestSchema,
  describeModelFailure,
  type FlaggedFeed,
  type ToReplyByIdsResponse,
  PostBatchSchema,
  StyleNotesSchema,
  SelectVersionRequestSchema,
  type DigestView,
  type DoctorReport,
  type HealthResponse,
  type VoiceView,
} from '@xc/shared';
import { isAuthorized } from './auth';
import type { ManualDigestOutcome } from './digest/digest';
import { selectVersion } from './polish/drafts-store';
import type { PolishState } from './polish/polish';
import { log } from './log';
import { ingestPosts, listFlaggedPosts, listPosts, lookupInlineStates, setCopied, setReplied, type PolishContext } from './posts';
import type { PrefilterRules } from './triage/prefilter';
import type { FlagOutcome, RetriageOutcome } from './triage/triage';
import { recordFeedback } from './voice/feedback';
import { readStyleNotes, saveStyleNotes } from './voice/style-notes';

const MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

type Handler = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void> | void;
type ParamHandler = (id: string) => Handler;

interface ParamRoute {
  pattern: RegExp;
  handler: ParamHandler;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        resolve(null);
        req.removeAllListeners('data');
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function parseIntParam(value: string | null, fallback: number): number | null {
  if (value === null) return fallback;
  return /^\d{1,15}$/.test(value) ? Number(value) : null;
}

function postPosts(db: DatabaseSync, ownHandle: string, onIngest: () => void): Handler {
  return async (req, res) => {
    const raw = await readBody(req);
    if (raw === null) return sendJson(res, 413, { error: 'body too large' });
    const batch = PostBatchSchema.safeParse(parseJson(raw));
    if (!batch.success) return sendJson(res, 400, { error: 'invalid batch' });
    const result = ingestPosts(db, batch.data.posts, Date.now(), ownHandle);
    log(`ingested ${batch.data.posts.map((p) => p.statusId).join(',')}`);
    onIngest();
    sendJson(res, 200, result);
  };
}

function isFlaggedFeed(value: string): value is FlaggedFeed {
  return (FLAGGED_FEEDS as readonly string[]).includes(value);
}

function getPosts(db: DatabaseSync, polishContext: () => PolishContext, flagRules: PrefilterRules): Handler {
  return (_req, res, url) => {
    const limit = parseIntParam(url.searchParams.get('limit'), DEFAULT_LIMIT);
    const before = parseIntParam(url.searchParams.get('before'), 0);
    if (!limit || before === null || limit > MAX_LIMIT) return sendJson(res, 400, { error: 'bad query' });
    const view = url.searchParams.get('view');
    const feed = url.searchParams.get('feed') ?? 'to_reply';
    if (view === 'flagged') {
      if (!isFlaggedFeed(feed)) return sendJson(res, 400, { error: 'bad query' });
      return sendJson(res, 200, listFlaggedPosts(db, limit, polishContext(), flagRules, Date.now(), feed));
    }
    if (view !== null && view !== 'all') return sendJson(res, 400, { error: 'bad query' });
    sendJson(res, 200, listPosts(db, limit, before || null, polishContext()));
  };
}

const STATUS_ID = /^\d{1,30}$/;

/** "1,2,3" -> unique ids, or null when any id is malformed or there are too many. */
function parseStatusIds(value: string | null): string[] | null {
  const ids = [...new Set((value ?? '').split(',').filter(Boolean))];
  if (ids.length === 0 || ids.length > MAX_INLINE_IDS || !ids.every((id) => STATUS_ID.test(id))) return null;
  return ids;
}

function getToReplyByIds(db: DatabaseSync, hooks: RouterHooks): Handler {
  return (_req, res, url) => {
    const ids = parseStatusIds(url.searchParams.get('ids'));
    if (!ids) return sendJson(res, 400, { error: 'bad query' });
    const now = Date.now();
    const pausedUntil = hooks.triagePausedUntil();
    sendJson(res, 200, {
      ...lookupInlineStates(db, ids, hooks.polishContext(), hooks.flagRules, now),
      triagePausedUntil: pausedUntil > now ? pausedUntil : null,
    } satisfies ToReplyByIdsResponse);
  };
}

const REPLIED_PATH = /^\/v1\/posts\/(\d{1,30})\/replied$/;
const COPIED_PATH = /^\/v1\/posts\/(\d{1,30})\/copied$/;
const POLISH_PATH = /^\/v1\/posts\/(\d{1,30})\/polish$/;
const RETRIAGE_PATH = /^\/v1\/posts\/(\d{1,30})\/retriage$/;
const FLAG_PATH = /^\/v1\/posts\/(\d{1,30})\/flag$/;

const FEEDBACK_PATH = /^\/v1\/drafts\/(\d{1,30}|rough-\d{1,30}|idea-\d{1,9}-\d)\/feedback$/;
const SELECT_PATH = /^\/v1\/drafts\/(\d{1,30}|idea-\d{1,9}-\d)\/select$/;
const IDEA_POLISH_PATH = /^\/v1\/ideas\/(\d{1,9}-\d)\/polish$/;

const POLISH_STATUS: Record<PolishState, number> = { started: 202, already: 202, unknown: 404, limit: 409 };

function postPolish(onPolish: (id: string, regenerate: boolean) => PolishState): ParamHandler {
  return (id) => (_req, res, url) => {
    const state = onPolish(id, url.searchParams.get('regenerate') === '1');
    if (state === 'unknown') return sendJson(res, 404, { error: 'not found' });
    sendJson(res, POLISH_STATUS[state], { state });
  };
}

function postRetriage(onRetriage: (statusId: string) => RetriageOutcome): ParamHandler {
  return (statusId) => (_req, res) => {
    const outcome = onRetriage(statusId);
    switch (outcome.status) {
      case 'queued':
        return sendJson(res, 202, { state: 'queued', ...(outcome.resumesAt ? { resumesAt: outcome.resumesAt } : {}) });
      case 'unknown':
        return sendJson(res, 404, { error: 'not found' });
      case 'not_failed':
        return sendJson(res, 409, { error: 'Triage did not fail for this post' });
      case 'unavailable':
        return sendJson(res, 503, { error: 'No triage model configured' });
      case 'skipped':
        return sendJson(res, 409, { error: `Not retried: this post is now skipped (${outcome.reason})` });
    }
  };
}

function postFlag(onFlag: (statusId: string) => FlagOutcome): ParamHandler {
  return (statusId) => (_req, res) => {
    const outcome = onFlag(statusId);
    switch (outcome.status) {
      case 'queued':
        return sendJson(res, 202, { state: 'queued', ...(outcome.resumesAt ? { resumesAt: outcome.resumesAt } : {}) });
      case 'drafted':
        return sendJson(res, 200, { state: 'drafted' });
      case 'unknown':
        return sendJson(res, 404, { error: 'not found' });
      case 'own':
        return sendJson(res, 409, { error: 'Your own post cannot be flagged' });
      case 'unavailable':
        return sendJson(res, 503, { error: 'No triage model configured' });
    }
  };
}

const SELECT_STATUS ={ ok: 200, not_found: 404, busy: 409 } as const;

function postSelect(db: DatabaseSync): ParamHandler {
  return (draftId) => async (req, res) => {
    const raw = await readBody(req);
    if (raw === null) return sendJson(res, 413, { error: 'body too large' });
    const request = SelectVersionRequestSchema.safeParse(parseJson(raw));
    if (!request.success) return sendJson(res, 400, { error: 'invalid selection' });
    const outcome = selectVersion(db, draftId, request.data.versionId);
    sendJson(res, SELECT_STATUS[outcome], outcome === 'ok' ? { ok: true } : { error: outcome });
  };
}

function postFeedback(db: DatabaseSync): ParamHandler {
  return (draftId) => async (req, res) => {
    const raw = await readBody(req);
    if (raw === null) return sendJson(res, 413, { error: 'body too large' });
    const feedback = FeedbackRequestSchema.safeParse(parseJson(raw));
    if (!feedback.success) return sendJson(res, 400, { error: 'invalid feedback' });
    const outcome = recordFeedback(db, draftId, feedback.data, Date.now());
    if (!outcome.ok) return sendJson(res, outcome.status, { error: outcome.error });
    log(`feedback ${draftId} ${feedback.data.kind}`);
    sendJson(res, 200, { ok: true });
  };
}

function postReplied(db: DatabaseSync): ParamHandler {
  return (statusId) => async (req, res) => {
    const raw = await readBody(req);
    if (raw === null) return sendJson(res, 413, { error: 'body too large' });
    const request = RepliedRequestSchema.safeParse(parseJson(raw));
    if (!request.success) return sendJson(res, 400, { error: 'invalid replied request' });
    if (!setReplied(db, statusId, request.data.replied, Date.now())) return sendJson(res, 404, { error: 'not found' });
    sendJson(res, 200, { ok: true });
  };
}

function postCopied(db: DatabaseSync): ParamHandler {
  return (statusId) => (_req, res) => {
    if (!setCopied(db, statusId, Date.now())) return sendJson(res, 404, { error: 'not found' });
    sendJson(res, 200, { ok: true });
  };
}

function postStyleNotes(db: DatabaseSync): Handler {
  return async (req, res) => {
    const raw = await readBody(req);
    if (raw === null) return sendJson(res, 413, { error: 'body too large' });
    const request = StyleNotesSchema.safeParse(parseJson(raw));
    if (!request.success) return sendJson(res, 400, { error: 'invalid style notes' });
    saveStyleNotes(db, request.data.notes, Date.now());
    sendJson(res, 200, { notes: readStyleNotes(db) });
  };
}

function postDigestRun(runNow: () => Promise<ManualDigestOutcome>): Handler {
  return async (_req, res) => {
    const outcome = await runNow();
    switch (outcome.status) {
      case 'ok':
        return sendJson(res, 200, { ok: true });
      case 'busy':
        return sendJson(res, 409, { error: 'A digest is already running' });
      case 'unavailable':
        return sendJson(res, 503, { error: 'No triage model configured' });
      case 'too_few':
        return sendJson(res, 422, { error: `Not enough captured posts yet (need at least ${outcome.needed})` });
      case 'throttled':
        res.setHeader('retry-after', String(outcome.retryAfterSec));
        return sendJson(res, 429, { error: 'Please wait before generating again', retryAfterSec: outcome.retryAfterSec });
      case 'paused':
        return sendJson(res, 503, { error: describeModelFailure('paused'), resumesAt: outcome.until });
      case 'failed':
        return sendJson(res, 502, {
          error: `Digest generation failed: ${describeModelFailure(outcome.kind)}`,
          ...(outcome.resumesAt ? { resumesAt: outcome.resumesAt } : {}),
        });
    }
  };
}

function findParamHandler(method: string | undefined, pathname: string, routes: ParamRoute[]): Handler | undefined {
  if (method !== 'POST') return undefined;
  for (const route of routes) {
    const id = route.pattern.exec(pathname)?.[1];
    if (id) return route.handler(id);
  }
  return undefined;
}

export interface RouterHooks {
  onIngest: () => void;
  onPolish: (statusId: string, regenerate: boolean) => PolishState;
  onIdeaPolish: (ideaId: string) => PolishState;
  onRetriage: (statusId: string) => RetriageOutcome;
  onFlag: (statusId: string) => FlagOutcome;
  /** When triage resumes after a quota pause on every model (0 or past: not paused). */
  triagePausedUntil: () => number;
  polishContext: () => PolishContext;
  doctor: () => Promise<DoctorReport>;
  voiceView: () => VoiceView;
  digestView: () => DigestView;
  runDigestNow: () => Promise<ManualDigestOutcome>;
  ownHandle: string;
  flagRules: PrefilterRules;
}

export function createRouter(
  db: DatabaseSync,
  hooks: RouterHooks,
  token: string,
): (req: IncomingMessage, res: ServerResponse) => void {
  const routes: Record<string, Handler> = {
    'GET /v1/health': (_req, res) => sendJson(res, 200, { status: 'ok' } satisfies HealthResponse),
    'GET /v1/posts': getPosts(db, hooks.polishContext, hooks.flagRules),
    'POST /v1/posts': postPosts(db, hooks.ownHandle, hooks.onIngest),
    'GET /v1/posts/to-reply': getToReplyByIds(db, hooks),
    'GET /v1/doctor': async (_req, res) => sendJson(res, 200, await hooks.doctor()),
    'GET /v1/voice': (_req, res) => sendJson(res, 200, hooks.voiceView()),
    'GET /v1/style-notes': (_req, res) => sendJson(res, 200, { notes: readStyleNotes(db) }),
    'POST /v1/style-notes': postStyleNotes(db),
    'GET /v1/digest': (_req, res) => sendJson(res, 200, hooks.digestView()),
    'POST /v1/digest/run': postDigestRun(hooks.runDigestNow),
  };
  const paramRoutes: ParamRoute[] = [
    { pattern: POLISH_PATH, handler: postPolish(hooks.onPolish) },
    { pattern: IDEA_POLISH_PATH, handler: postPolish(hooks.onIdeaPolish) },
    { pattern: RETRIAGE_PATH, handler: postRetriage(hooks.onRetriage) },
    { pattern: FLAG_PATH, handler: postFlag(hooks.onFlag) },
    { pattern: REPLIED_PATH, handler: postReplied(db) },
    { pattern: COPIED_PATH, handler: postCopied(db) },
    { pattern: FEEDBACK_PATH, handler: postFeedback(db) },
    { pattern: SELECT_PATH, handler: postSelect(db) },
  ];
  return (req, res) => {
    if (!isAuthorized(req.headers.authorization, token)) return sendJson(res, 401, { error: 'unauthorized' });
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const handler = routes[`${req.method} ${url.pathname}`] ?? findParamHandler(req.method, url.pathname, paramRoutes);
    if (!handler) return sendJson(res, 404, { error: 'not found' });
    Promise.resolve(handler(req, res, url)).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
    });
  };
}
