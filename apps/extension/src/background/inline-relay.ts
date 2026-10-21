import {
  InlineActionMessageSchema,
  InlineDraftsMessageSchema,
  JobListMessageSchema,
  JobProgressMessageSchema,
  ToReplyByIdsResponseSchema,
  type InlineActionMessage,
  type ToReplyByIdsResponse,
} from '@xc/shared/types';
import { fetchJob, fetchJobs, flagPost, getJson, markCopied, requestPolish, sendFeedback } from '../server-api';
import { getServerConfig } from '../server-config';

/** Offline (no token): nothing is in To reply or flaggable, so no pills, and no request is made. */
async function lookupToReply(statusIds: string[]): Promise<ToReplyByIdsResponse | { error: string }> {
  try {
    if (!(await getServerConfig()).token) return ToReplyByIdsResponseSchema.parse({ posts: [] });
    return ToReplyByIdsResponseSchema.parse(await getJson(`/v1/posts/to-reply?ids=${statusIds.join(',')}`));
  } catch {
    return { error: 'lookup failed' };
  }
}

// Copy feedback can be refused (a guard-breaking draft is no style example); the copy itself still counts.
async function recordCopy(statusId: string, draftId: string): Promise<string | null> {
  await sendFeedback(draftId, 'copy');
  await markCopied(statusId);
  return null;
}

async function runAction({ action, statusId, draftId }: InlineActionMessage): Promise<string | null> {
  switch (action) {
    case 'copy':
      return recordCopy(statusId, draftId);
    case 'up':
    case 'down':
      return sendFeedback(draftId, action);
    case 'polish':
      return requestPolish(statusId).then(() => null);
    case 'regenerate':
      return requestPolish(statusId, true).then(() => null);
    case 'flag':
      return flagPost(statusId);
  }
}

async function runInlineAction(message: InlineActionMessage): Promise<{ error: string | null }> {
  try {
    return { error: await runAction(message) };
  } catch {
    return { error: 'Server offline.' };
  }
}

/** The reply to an inline-drafts message from the content script, or null when the message is something else. */
export function answerInlineMessage(message: unknown): Promise<unknown> | null {
  const lookup = InlineDraftsMessageSchema.safeParse(message);
  if (lookup.success) return lookupToReply(lookup.data.statusIds);
  const action = InlineActionMessageSchema.safeParse(message);
  if (action.success) return runInlineAction(action.data);
  const job = JobProgressMessageSchema.safeParse(message);
  // An unreachable server is not an unknown job: the content script keeps the last steps it saw.
  if (job.success) return fetchJob(job.data.jobId).then((view) => ({ job: view }), () => ({ job: null, error: 'unreachable' }));
  return JobListMessageSchema.safeParse(message).success ? fetchJobs().then((jobs) => ({ jobs }), () => ({ jobs: [] })) : null;
}
