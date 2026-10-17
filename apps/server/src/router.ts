import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import { PostBatchSchema, type HealthResponse } from '@xc/shared';
import { ingestPosts, listPosts } from './posts';

const MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

type Handler = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void> | void;

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

function postPosts(db: DatabaseSync): Handler {
  return async (req, res) => {
    const raw = await readBody(req);
    if (raw === null) return sendJson(res, 413, { error: 'body too large' });
    const batch = PostBatchSchema.safeParse(parseJson(raw));
    if (!batch.success) return sendJson(res, 400, { error: 'invalid batch' });
    const result = ingestPosts(db, batch.data.posts, Date.now());
    console.log(`ingested ${batch.data.posts.map((p) => p.statusId).join(',')}`);
    sendJson(res, 200, result);
  };
}

function getPosts(db: DatabaseSync): Handler {
  return (_req, res, url) => {
    const limit = parseIntParam(url.searchParams.get('limit'), DEFAULT_LIMIT);
    const before = parseIntParam(url.searchParams.get('before'), 0);
    if (!limit || before === null || limit > MAX_LIMIT) return sendJson(res, 400, { error: 'bad query' });
    sendJson(res, 200, listPosts(db, limit, before || null));
  };
}

export function createRouter(db: DatabaseSync): (req: IncomingMessage, res: ServerResponse) => void {
  const routes: Record<string, Handler> = {
    'GET /v1/health': (_req, res) => sendJson(res, 200, { status: 'ok' } satisfies HealthResponse),
    'GET /v1/posts': getPosts(db),
    'POST /v1/posts': postPosts(db),
  };
  return (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const handler = routes[`${req.method} ${url.pathname}`];
    if (!handler) return sendJson(res, 404, { error: 'not found' });
    Promise.resolve(handler(req, res, url)).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
    });
  };
}
