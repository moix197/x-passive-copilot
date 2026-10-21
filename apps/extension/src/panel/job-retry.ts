import type { JobEntry } from '@xc/shared/types';
import { postJson, requestPolish } from '../server-api';

// Generating answers only when the job ends; the Activity tab follows the new job, so the reply is not awaited.
function retryIdea({ ideaKind, target }: JobEntry): void {
  const source = target.type === 'post' ? { statusId: target.statusId, authorHandle: target.authorHandle, text: target.text } : undefined;
  const body = { ...(ideaKind ? { kind: ideaKind } : {}), ...(source ? { source } : {}), jobId: `idea-${crypto.randomUUID()}` };
  void postJson('/v1/ideas/generate', body).catch(() => undefined);
}

async function retryPolish({ kind, target }: JobEntry): Promise<void> {
  if (target.type === 'post' && target.statusId) return requestPolish(target.statusId, kind === 'regenerate');
  if (target.type !== 'idea') return;
  const res = await postJson(`/v1/ideas/${encodeURIComponent(target.ideaId)}/polish`);
  if (!res.ok) throw new Error(`server ${res.status}`);
}

/** Starts a failed job's work again: the same idea request, polish, regenerate or digest run. */
export async function retryJob(job: JobEntry): Promise<void> {
  if (job.kind === 'polish' || job.kind === 'regenerate') return retryPolish(job);
  if (job.kind === 'digest') return void postJson('/v1/digest/run').catch(() => undefined);
  retryIdea(job);
}
