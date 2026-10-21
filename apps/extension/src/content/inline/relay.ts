import {
  ToReplyByIdsResponseSchema,
  type InlineActionKind,
  type InlineActionMessage,
  type InlineDraftsMessage,
  type StoredPost,
} from '@xc/shared/types';

// The content script never talks to the server itself: the service worker owns the token and the fetch.

/** The asked posts that are in To reply; throws when the service worker or server is unreachable. */
export async function fetchToReply(statusIds: string[]): Promise<StoredPost[]> {
  const message: InlineDraftsMessage = { type: 'inline-drafts', statusIds };
  const reply = await chrome.runtime.sendMessage(message);
  return ToReplyByIdsResponseSchema.parse(reply).posts;
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
