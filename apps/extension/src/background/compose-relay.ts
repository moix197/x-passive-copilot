import {
  ComposeIdeasMessageSchema,
  ComposeIdeasReplySchema,
  DigestIdeaSchema,
  DigestViewSchema,
  type ComposeIdeasMessage,
  type ComposeIdeasReply,
} from '@xc/shared/types';
import { viewIdeas } from '../drafts/idea-list';
import { errorText, getJson, postJson } from '../server-api';
import { getServerConfig } from '../server-config';

const OFFLINE = 'Server offline.';

const reply = (fields: Partial<ComposeIdeasReply>): ComposeIdeasReply => ComposeIdeasReplySchema.parse(fields);

async function listIdeas(): Promise<ComposeIdeasReply> {
  return reply({ ideas: viewIdeas(DigestViewSchema.parse(await getJson('/v1/digest'))) });
}

async function refusal(res: Response): Promise<ComposeIdeasReply> {
  const body = (await res.clone().json().catch(() => ({}))) as { resumesAt?: unknown };
  const resumesAt = typeof body.resumesAt === 'number' ? body.resumesAt : null;
  return reply({ error: await errorText(res), resumesAt });
}

async function generateIdea(): Promise<ComposeIdeasReply> {
  const res = await postJson('/v1/ideas/generate');
  if (!res.ok) return refusal(res);
  const { idea } = (await res.json()) as { idea?: unknown };
  return reply({ ideas: [DigestIdeaSchema.parse(idea)] });
}

async function runComposeIdeas({ action }: ComposeIdeasMessage): Promise<ComposeIdeasReply> {
  try {
    if (!(await getServerConfig()).token) return reply({ error: OFFLINE });
    return await (action === 'list' ? listIdeas() : generateIdea());
  } catch {
    return reply({ error: OFFLINE });
  }
}

/** The reply to a compose-ideas message from the content script, or null when the message is something else. */
export function answerComposeMessage(message: unknown): Promise<ComposeIdeasReply> | null {
  const parsed = ComposeIdeasMessageSchema.safeParse(message);
  return parsed.success ? runComposeIdeas(parsed.data) : null;
}
