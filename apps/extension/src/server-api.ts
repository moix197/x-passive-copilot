import { JobEntrySchema, JobListSchema, type JobEntry } from '@xc/shared/types';
import { authHeaders, getServerConfig } from './server-config';

export type FeedbackKind = 'copy' | 'edit' | 'up' | 'down';

export async function postJson(path: string, body?: unknown, signal?: AbortSignal): Promise<Response> {
  const config = await getServerConfig();
  const headers = { ...authHeaders(config), ...(body === undefined ? {} : { 'content-type': 'application/json' }) };
  return fetch(`${config.baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
}

export async function getJson(path: string): Promise<unknown> {
  const config = await getServerConfig();
  const res = await fetch(`${config.baseUrl}${path}`, { headers: authHeaders(config) });
  if (!res.ok) throw new Error(`server ${res.status}`);
  return res.json();
}

/** A job's steps and what it is for; null when the server does not know the job; throws when unreachable. */
export async function fetchJob(jobId: string): Promise<JobEntry | null> {
  const config = await getServerConfig();
  const res = await fetch(`${config.baseUrl}/v1/jobs?id=${encodeURIComponent(jobId)}`, { headers: authHeaders(config) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`server ${res.status}`);
  return JobEntrySchema.parse(await res.json());
}

/** Running and recent jobs, newest first. */
export async function fetchJobs(): Promise<JobEntry[]> {
  return JobListSchema.parse(await getJson('/v1/jobs')).jobs;
}

export async function errorText(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: unknown };
  return typeof body.error === 'string' ? body.error : `server ${res.status}`;
}

export async function requestPolish(statusId: string, regenerate = false): Promise<void> {
  const query = regenerate ? '?regenerate=1' : '';
  const res = await postJson(`/v1/posts/${encodeURIComponent(statusId)}/polish${query}`);
  if (!res.ok) throw new Error(`server ${res.status}`);
}

/** Resolves to the server's refusal, or null when the feedback was saved. */
export async function sendFeedback(draftId: string, kind: FeedbackKind, text?: string): Promise<string | null> {
  const res = await postJson(`/v1/drafts/${encodeURIComponent(draftId)}/feedback`, { kind, text });
  return res.ok ? null : errorText(res);
}

export async function markCopied(statusId: string): Promise<void> {
  const res = await postJson(`/v1/posts/${encodeURIComponent(statusId)}/copied`);
  if (!res.ok) throw new Error(`server ${res.status}`);
}

/** Flags a post by hand; resolves to the server's refusal, or null when it was flagged (its draft may still be on the way). */
export async function flagPost(statusId: string): Promise<string | null> {
  const res = await postJson(`/v1/posts/${encodeURIComponent(statusId)}/flag`);
  return res.ok ? null : errorText(res);
}
