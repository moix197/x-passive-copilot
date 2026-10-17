import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { err, ok, PolishReplySchema, type PolishReply, type Result } from '@xc/shared';
import { z } from 'zod';
import { resolveCli } from './resolve-cli';
import { runCli } from './run-cli';

const POLISH_TIMEOUT_MS = 180_000;
const MAX_TURNS = '8';
// src/llm/ when run by tsx, dist/assets/ when bundled
const ASSET_CANDIDATES = ['../../assets', 'assets'].map((d) => join(import.meta.dirname, d, 'finalize-system.md'));
const SYSTEM_ASSET = ASSET_CANDIDATES.find((p) => existsSync(p)) ?? ASSET_CANDIDATES[0]!;

// Read rules scope to cwd (the repo); claude applies Read rules best-effort to Grep/Glob too.
const ALLOWED_TOOLS = 'Read(./**),Grep,Glob';
const DENIED_TOOLS = 'Bash,Edit,Write,NotebookEdit,WebFetch,WebSearch,Task';

export const REPLY_JSON_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    reply: { type: 'string', maxLength: 280 },
    rationale: { type: 'string' },
  },
  required: ['reply', 'rationale'],
  additionalProperties: false,
});

const EnvelopeSchema = z.looseObject({
  is_error: z.boolean().optional(),
  structured_output: z.unknown().optional(),
});

export function buildClaudeArgv(base: string[], model: string, systemFile: string = SYSTEM_ASSET): string[] {
  return [
    ...base, '-p', '--model', model,
    '--allowedTools', ALLOWED_TOOLS,
    '--disallowedTools', DENIED_TOOLS,
    '--permission-mode', 'dontAsk',
    '--strict-mcp-config',
    '--max-turns', MAX_TURNS,
    '--output-format', 'json',
    '--json-schema', REPLY_JSON_SCHEMA,
    '--append-system-prompt-file', systemFile,
  ];
}

export function claudeEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const copy = { ...env };
  for (const key of Object.keys(copy)) {
    if (['ANTHROPIC_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'].includes(key.toUpperCase())) delete copy[key];
  }
  return copy;
}

export function parseClaudeOutput(stdout: string): Result<PolishReply> {
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    return err('malformed output: claude stdout is not JSON');
  }
  const envelope = EnvelopeSchema.safeParse(json);
  if (!envelope.success || envelope.data.is_error) return err('claude reported an error');
  const reply = PolishReplySchema.safeParse(envelope.data.structured_output);
  return reply.success ? ok(reply.data) : err('malformed output: no structured reply');
}

export async function runClaude(prompt: string, model: string, repoPath: string): Promise<Result<PolishReply>> {
  if (!model) return err('config: models.final is not set');
  if (!repoPath || !existsSync(repoPath)) return err('config: spacehoodRepoPath is not a directory');
  const cli = resolveCli('claude');
  if (!cli.ok) return cli;
  const out = await runCli({
    argv: buildClaudeArgv(cli.value, model),
    stdin: prompt,
    cwd: repoPath,
    env: claudeEnv(),
    timeoutMs: POLISH_TIMEOUT_MS,
  });
  return out.ok ? parseClaudeOutput(out.value.stdout) : out;
}
