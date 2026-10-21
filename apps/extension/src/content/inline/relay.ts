import {
  ComposeIdeasReplySchema,
  JobEntrySchema,
  JobListSchema,
  ToReplyByIdsResponseSchema,
  type ComposeIdeasMessage,
  type ComposeIdeasReply,
  type IdeaKind,
  type IdeaSourceInput,
  type InlineActionKind,
  type InlineActionMessage,
  type InlineDraftsMessage,
  type JobEntry,
  type JobListMessage,
  type JobProgressMessage,
  type ToReplyByIdsResponse,
} from '@xc/shared/types';

// The content script never talks to the server itself: the service worker owns the token and the fetch.

/** Where each asked post stands (To reply, replied, flaggable); throws when the service worker or server is unreachable. */
export async function fetchToReply(statusIds: string[]): Promise<ToReplyByIdsResponse> {
  const message: InlineDraftsMessage = { type: 'inline-drafts', statusIds };
  const reply = await chrome.runtime.sendMessage(message);
  return ToReplyByIdsResponseSchema.parse(reply);
}

/** Resolves to the server's refusal, or null when the action was accepted. */
export async function sendInlineAction(action: InlineActionKind, statusId: string, draftId: string): Promise<string | null> {
  const message: InlineActionMessage = { type: 'inline-action', action, statusId, draftId };
  try {
    const reply = (await chrome.runtime.sendMessage(message)) as { error?: unknown } | undefined;
    return typeof reply?.error === 'string' ? reply.error : null;
  } catch {
    return 'Extension unreachable.';
  }
}

/**
 * Recent ideas, or the one just generated (of `kind`, or the mixed rotation; for `source` when the user picked
 * the post); never throws (an unreachable worker comes back as the error).
 */
export async function askComposeIdeas(
  action: ComposeIdeasMessage['action'],
  kind?: IdeaKind,
  source?: IdeaSourceInput,
  jobId?: string,
): Promise<ComposeIdeasReply> {
  const message: ComposeIdeasMessage = {
    type: 'compose-ideas',
    action,
    ...(kind ? { kind } : {}),
    ...(source ? { source } : {}),
    ...(jobId ? { jobId } : {}),
  };
  try {
    return ComposeIdeasReplySchema.parse(await chrome.runtime.sendMessage(message));
  } catch {
    return ComposeIdeasReplySchema.parse({ error: 'Extension unreachable.' });
  }
}

/** A job's steps (an idea, a polish); null when the server does not know it; throws when unreachable, so the caller asks again. */
export async function fetchJobProgress(jobId: string): Promise<JobEntry | null> {
  const message: JobProgressMessage = { type: 'job-progress', jobId };
  const reply = (await chrome.runtime.sendMessage(message)) as { job?: unknown; error?: unknown } | undefined;
  if (!reply || reply.error) throw new Error('unreachable');
  return reply.job ? JobEntrySchema.parse(reply.job) : null;
}

/** Running and recent jobs, newest first; empty when unreachable. */
export async function fetchJobList(): Promise<JobEntry[]> {
  const message: JobListMessage = { type: 'job-list' };
  try {
    return JobListSchema.parse(await chrome.runtime.sendMessage(message)).jobs;
  } catch {
    return [];
  }
}

/** The newest job with this key (a post's idea, the compose box), running or finished. */
export async function latestJobFor(key: string): Promise<JobEntry | null> {
  return (await fetchJobList()).find((job) => job.key === key) ?? null;
}

/** A fresh id for following one idea generation. */
export const newIdeaJobId = (): string => `idea-${crypto.randomUUID()}`;
