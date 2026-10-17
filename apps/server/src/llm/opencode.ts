import { err, ok, TriageItemSchema, type Result, type TriageItem } from '@xc/shared';
import { z } from 'zod';
import { ensureOpencodeSandbox } from '../sandbox';
import { resolveCli } from './resolve-cli';
import { runCli } from './run-cli';

const TRIAGE_TIMEOUT_MS = 120_000;

// Event shape follows opencode's `run --format json` (one JSON object per line); UNVERIFIED
// against a live install, see .ai/pipeline/triage-flow.
const EventSchema = z.looseObject({
  type: z.string(),
  part: z.looseObject({ text: z.string().optional(), reason: z.string().optional() }).optional(),
});

export function parseOpencodeEvents(stdout: string): Result<string> {
  const texts: string[] = [];
  let finished = false;
  for (const line of stdout.split('\n')) {
    const event = parseEventLine(line);
    if (!event) continue;
    if (event.type === 'error') return err('opencode reported an error event');
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
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  const candidate = fenced ?? (start !== -1 && end > start ? text.slice(start, end + 1) : '');
  try {
    return ok(JSON.parse(candidate));
  } catch {
    return err('malformed output: no JSON array');
  }
}

export interface TriageReply {
  items: TriageItem[];
  invalidIds: string[];
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
    const item = TriageItemSchema.safeParse(raw);
    if (item.success) reply.items.push(item.data);
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
    timeoutMs: TRIAGE_TIMEOUT_MS,
  });
  return out.ok ? parseOpencodeEvents(out.value.stdout) : out;
}
