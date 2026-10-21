import {
  ComposeIdeasReplySchema,
  ToReplyByIdsResponseSchema,
  type ComposeIdeasMessage,
  type ComposeIdeasReply,
  type InlineActionKind,
  type InlineActionMessage,
  type InlineDraftsMessage,
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

/** Recent ideas, or the one just generated; never throws (an unreachable worker comes back as the error). */
export async function askComposeIdeas(action: ComposeIdeasMessage['action']): Promise<ComposeIdeasReply> {
  const message: ComposeIdeasMessage = { type: 'compose-ideas', action };
  try {
    return ComposeIdeasReplySchema.parse(await chrome.runtime.sendMessage(message));
  } catch {
    return ComposeIdeasReplySchema.parse({ error: 'Extension unreachable.' });
  }
}
