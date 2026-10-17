import { describe, expect, it } from 'vitest';
import { buildClaudeArgv, claudeEnv, parseClaudeOutput, REPLY_JSON_SCHEMA } from './claude';
import { childEnv } from './run-cli';

const argv = buildClaudeArgv(['claude'], 'sonnet-x', 'C:/assets/finalize-system.md');
const valueOf = (flag: string) => argv[argv.indexOf(flag) + 1];

describe('buildClaudeArgv', () => {
  it('uses the read-only flag profile', () => {
    expect(argv.slice(0, 3)).toEqual(['claude', '-p', '--model']);
    expect(valueOf('--model')).toBe('sonnet-x');
    expect(valueOf('--allowedTools')).toBe('Read(./**),Grep,Glob');
    expect(valueOf('--permission-mode')).toBe('dontAsk');
    expect(valueOf('--output-format')).toBe('json');
    expect(valueOf('--append-system-prompt-file')).toBe('C:/assets/finalize-system.md');
    expect(argv).toContain('--strict-mcp-config');
    expect(valueOf('--json-schema')).toBe(REPLY_JSON_SCHEMA);
  });

  it('denies every write/exec/network tool', () => {
    const denied = valueOf('--disallowedTools')?.split(',');
    expect(denied).toEqual(['Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Task']);
  });

  it('never uses --bare and carries no prompt text', () => {
    expect(argv).not.toContain('--bare');
    expect(argv.every((a) => !a.includes('<post>'))).toBe(true);
  });
});

describe('claudeEnv', () => {
  it('removes ANTHROPIC_API_KEY in any case and keeps the rest', () => {
    const env = claudeEnv({ ANTHROPIC_API_KEY: 'k', anthropic_api_key: 'k', PATH: '/bin' });
    expect(Object.keys(env)).toEqual(['PATH']);
  });
});

describe('childEnv', () => {
  it('strips XC_* secrets in any case and keeps the rest', () => {
    const env = childEnv({ XC_DEV_TOKEN: 't', xc_other: 'x', PATH: '/bin', HOME: '/h' });
    expect(env).toEqual({ PATH: '/bin', HOME: '/h' });
  });
});

describe('parseClaudeOutput', () => {
  const envelope = (extra: object) => JSON.stringify({ type: 'result', is_error: false, ...extra });

  it('reads structured_output', () => {
    const out = parseClaudeOutput(envelope({ structured_output: { reply: 'hi', rationale: 'r' } }));
    expect(out).toEqual({ ok: true, value: { reply: 'hi', rationale: 'r' } });
  });

  it('rejects errors, missing structured output and non-JSON', () => {
    expect(parseClaudeOutput(envelope({ is_error: true })).ok).toBe(false);
    expect(parseClaudeOutput(envelope({ result: 'text only' })).ok).toBe(false);
    expect(parseClaudeOutput('nope').ok).toBe(false);
  });
});
