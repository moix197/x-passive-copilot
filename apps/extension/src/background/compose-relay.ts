import {
  ComposeIdeasMessageSchema,
  ComposeIdeasReplySchema,
  DigestIdeaSchema,
  DigestViewSchema,
  JobEntrySchema,
  SERVER_OFFLINE,
  type ComposeIdeasMessage,
  type ComposeIdeasReply,
} from '@xc/shared/types';
import { viewIdeas } from '../drafts/idea-list';
import { errorText, getJson, postJson } from '../server-api';
import { getServerConfig } from '../server-config';


const reply = (fields: Partial<ComposeIdeasReply>): ComposeIdeasReply => ComposeIdeasReplySchema.parse(fields);

async function listIdeas(): Promise<ComposeIdeasReply> {
  return reply({ ideas: viewIdeas(DigestViewSchema.parse(await getJson('/v1/digest'))) });
}

async function refusal(res: Response): Promise<ComposeIdeasReply> {
  const body = (await res.clone().json().catch(() => ({}))) as { resumesAt?: unknown };
  const resumesAt = typeof body.resumesAt === 'number' ? body.resumesAt : null;
  return reply({ error: await errorText(res), resumesAt });
}

async function generateIdea({ kind, source, jobId }: ComposeIdeasMessage): Promise<ComposeIdeasReply> {
  const body = { ...(kind ? { kind, ...(source ? { source } : {}) } : {}), ...(jobId ? { jobId } : {}) };
  const res = await postJson('/v1/ideas/generate', Object.keys(body).length ? body : undefined);
  if (!res.ok) return refusal(res);
  // 202: this target already had a generation running; the popover follows that job instead.
  if (res.status === 202) return reply({ job: JobEntrySchema.parse(((await res.json()) as { job?: unknown }).job) });
  const { idea } = (await res.json()) as { idea?: unknown };
  return reply({ ideas: [DigestIdeaSchema.parse(idea)] });
}

async function runComposeIdeas(message: ComposeIdeasMessage): Promise<ComposeIdeasReply> {
  try {
    if (!(await getServerConfig()).token) return reply({ error: SERVER_OFFLINE });
    return await (message.action === 'list' ? listIdeas() : generateIdea(message));
  } catch {
    return reply({ error: SERVER_OFFLINE });
  }
}

/** The reply to a compose-ideas message from the content script, or null when the message is something else. */
export function answerComposeMessage(message: unknown): Promise<ComposeIdeasReply> | null {
  const parsed = ComposeIdeasMessageSchema.safeParse(message);
  return parsed.success ? runComposeIdeas(parsed.data) : null;
}
