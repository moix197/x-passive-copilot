import {
  InlineActionMessageSchema,
  InlineDraftsMessageSchema,
  ToReplyByIdsResponseSchema,
  type InlineActionMessage,
  type ToReplyByIdsResponse,
} from '@xc/shared/types';
import { flagPost, getJson, markCopied, requestPolish, sendFeedback } from '../server-api';
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
  return action.success ? runInlineAction(action.data) : null;
}
