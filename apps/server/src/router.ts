import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import {
  FeedbackRequestSchema,
  PostBatchSchema,
  type DigestView,
  type DoctorReport,
  type HealthResponse,
  type VoiceView,
} from '@xc/shared';
import { isAuthorized } from './auth';
import type { PolishState } from './polish/polish';
import { log } from './log';
import { ingestPosts, listFlaggedPosts, listPosts, type PolishContext } from './posts';
import { recordFeedback } from './voice/feedback';

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

function getPosts(db: DatabaseSync, polishContext: () => PolishContext): Handler {
  return (_req, res, url) => {
    const limit = parseIntParam(url.searchParams.get('limit'), DEFAULT_LIMIT);
    const before = parseIntParam(url.searchParams.get('before'), 0);
    if (!limit || before === null || limit > MAX_LIMIT) return sendJson(res, 400, { error: 'bad query' });
    const view = url.searchParams.get('view');
    if (view === 'flagged') return sendJson(res, 200, listFlaggedPosts(db, limit, polishContext()));
    if (view !== null && view !== 'all') return sendJson(res, 400, { error: 'bad query' });
    sendJson(res, 200, listPosts(db, limit, before || null, polishContext()));
  };
}

const POLISH_PATH = /^\/v1\/posts\/(\d{1,30})\/polish$/;

const FEEDBACK_PATH = /^\/v1\/drafts\/(\d{1,30}|idea-\d{1,9}-\d)\/feedback$/;
const IDEA_POLISH_PATH = /^\/v1\/ideas\/(\d{1,9}-\d)\/polish$/;

function postPolish(onPolish: (id: string) => PolishState): ParamHandler {
  return (id) => (_req, res) => {
    const state = onPolish(id);
    if (state === 'unknown') return sendJson(res, 404, { error: 'not found' });
    sendJson(res, 202, { state });
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
  onPolish: (statusId: string) => PolishState;
  onIdeaPolish: (ideaId: string) => PolishState;
  polishContext: () => PolishContext;
  doctor: () => Promise<DoctorReport>;
  voiceView: () => VoiceView;
  digestView: () => DigestView;
  ownHandle: string;
}

export function createRouter(
  db: DatabaseSync,
  hooks: RouterHooks,
  token: string,
): (req: IncomingMessage, res: ServerResponse) => void {
  const routes: Record<string, Handler> = {
    'GET /v1/health': (_req, res) => sendJson(res, 200, { status: 'ok' } satisfies HealthResponse),
    'GET /v1/posts': getPosts(db, hooks.polishContext),
    'POST /v1/posts': postPosts(db, hooks.ownHandle, hooks.onIngest),
    'GET /v1/doctor': async (_req, res) => sendJson(res, 200, await hooks.doctor()),
    'GET /v1/voice': (_req, res) => sendJson(res, 200, hooks.voiceView()),
    'GET /v1/digest': (_req, res) => sendJson(res, 200, hooks.digestView()),
  };
  const paramRoutes: ParamRoute[] = [
    { pattern: POLISH_PATH, handler: postPolish(hooks.onPolish) },
    { pattern: IDEA_POLISH_PATH, handler: postPolish(hooks.onIdeaPolish) },
    { pattern: FEEDBACK_PATH, handler: postFeedback(db) },
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
