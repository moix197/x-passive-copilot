import { err, ok, TriageItemSchema, type Result, type TriageItem } from '@xc/shared';
import { z } from 'zod';
import { replaceDashes } from '../text/dashes';
import { ensureOpencodeSandbox } from '../sandbox';
import { opencodeEnv, redactKey } from './opencode-env';
import { resolveCli } from './resolve-cli';
import { exitFailure, runCli } from './run-cli';

const TRIAGE_TIMEOUT_MS = 120_000;

// Event shape of `opencode run --format json` (one JSON object per line), recorded from opencode
// 1.19.3 in fixtures/opencode-run.jsonl. Each step is step_start .. step_finish; tool calls arrive
// as tool_use events and end the step with reason "tool-calls".
const EventSchema = z.looseObject({
  type: z.string(),
  part: z
    .looseObject({
      text: z.string().optional(),
      reason: z.string().optional(),
      state: z.looseObject({ status: z.string().optional() }).optional(),
    })
    .optional(),
  error: z
    .looseObject({ name: z.string().optional(), data: z.looseObject({ message: z.string().optional() }).optional() })
    .optional(),
});

const OPENCODE_ERROR = 'opencode error';

// Provider/CLI error text (e.g. "FreeTierError ... 403"), never model output, so it is safe to log.
function errorEventMessage(event: z.infer<typeof EventSchema>): string {
  const detail = [event.error?.name, event.error?.data?.message].filter(Boolean).join(': ');
  return `${OPENCODE_ERROR}: ${detail.slice(0, 200) || 'unknown'}`;
}

export function parseOpencodeEvents(stdout: string): Result<string> {
  let texts: string[] = [];
  let finished = false;
  for (const line of stdout.split('\n')) {
    const event = parseEventLine(line);
    if (!event) continue;
    if (event.type === 'error') return err(errorEventMessage(event));
    // The sandbox denies every tool; a completed one means it was bypassed, so fail closed.
    if (event.type === 'tool_use' && event.part?.state?.status === 'completed') return err('opencode ran a tool');
    // Only the final step's text is the answer; earlier steps hold tool-call preambles.
    if (event.type === 'step_start') texts = [];
    if (event.type === 'text' && event.part?.text) texts.push(event.part.text);
    if (event.type === 'step_finish' && event.part?.reason !== 'tool-calls') finished = true;
  }
  if (!finished) return err('opencode output incomplete: no final event');
  return texts.length ? ok(texts.join('\n')) : err('opencode output had no text');
}

function parseEventLine(line: string): z.infer<typeof EventSchema> | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = EventSchema.safeParse(JSON.parse(trimmed));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function extractJson(text: string): Result<unknown> {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1];
  const end = text.lastIndexOf(']') + 1;
  // Live DeepSeek output sometimes holds a first array, prose ("let me correct"), then a fixed array;
  // the last `[{` is the fallback start for that case.
  const candidates = fenced !== undefined ? [fenced] : [text.slice(text.indexOf('['), end), text.slice(text.lastIndexOf('[{'), end)];
  for (const candidate of candidates) {
    try {
      return ok(JSON.parse(candidate));
    } catch {
      // try the next candidate
    }
  }
  return err('malformed output: no JSON array');
}

export interface TriageReply {
  items: TriageItem[];
  invalidIds: string[];
}

function withoutDashes(item: TriageItem): TriageItem {
  return { ...item, reason: replaceDashes(item.reason), roughDraft: replaceDashes(item.roughDraft) };
}

export function parseTriageReply(text: string, knownIds: ReadonlySet<string>): Result<TriageReply> {
  const json = extractJson(text);
  if (!json.ok) return json;
  if (!Array.isArray(json.value)) return err('malformed output: not an array');
  const reply: TriageReply = { items: [], invalidIds: [] };
  const seen = new Set<string>();
  for (const raw of json.value as unknown[]) {
    const id = (raw as { statusId?: unknown } | null)?.statusId;
    if (typeof id !== 'string' || !knownIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    // The model often omits roughDraft (live-observed); an absent draft is an empty one.
    const item = TriageItemSchema.safeParse({ roughDraft: '', ...(raw as object) });
    if (item.success) reply.items.push(withoutDashes(item.data));
    else reply.invalidIds.push(id);
  }
  return ok(reply);
}

export function buildOpencodeArgv(base: string[], model: string, dir: string): string[] {
  return [...base, 'run', '-m', model, '--format', 'json', '--dir', dir];
}

export async function runOpencode(prompt: string, model: string, home: string): Promise<Result<string>> {
  const cli = resolveCli('opencode');
  if (!cli.ok) return cli;
  const dir = ensureOpencodeSandbox(home);
  const out = await runCli({
    argv: buildOpencodeArgv(cli.value, model, dir),
    stdin: prompt,
    cwd: dir,
    env: opencodeEnv(),
    timeoutMs: TRIAGE_TIMEOUT_MS,
    allowNonZeroExit: true,
  });
  if (!out.ok) return err(redactKey(out.error));
  const events = parseOpencodeEvents(out.value.stdout);
  const reportedError = !events.ok && events.error.startsWith(OPENCODE_ERROR);
  if (out.value.exitCode !== 0 && !reportedError) return err(redactKey(exitFailure(out.value.exitCode ?? null, out.value.stderr)));
  return events.ok ? events : err(redactKey(events.error));
}
