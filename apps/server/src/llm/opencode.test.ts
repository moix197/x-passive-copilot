// fixtures/opencode-run.jsonl is a real `opencode run --format json` recording (opencode 1.19.3).
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensureOpencodeSandbox } from '../sandbox';
import { extractJson, parseOpencodeEvents, parseTriageReply } from './opencode';

const sample = readFileSync(join(import.meta.dirname, '../../../../fixtures/opencode-run.jsonl'), 'utf8');
const known = new Set(['1001', '1002']);
const item = (statusId: string, extra: object = {}) => ({
  statusId, relevant: true, replyWorthy: true, score: 70, reason: 'r', roughDraft: 'd', ...extra,
});
const events = (...lines: object[]) => lines.map((l) => JSON.stringify(l)).join('\n');
const finish = { type: 'step_finish', part: { reason: 'stop' } };

describe('ensureOpencodeSandbox', () => {
  it('writes a deny-all opencode config with no MCP servers', () => {
    const dir = ensureOpencodeSandbox(mkdtempSync(join(tmpdir(), 'xc-sandbox-')));
    const config = JSON.parse(readFileSync(join(dir, 'opencode.json'), 'utf8'));
    const { read: readTool, ...tools } = config.tools;
    const { read: readPermission, ...permissions } = config.permission;
    expect(tools['*']).toBe(false);
    expect(Object.values(tools).every((v) => v === false)).toBe(true);
    expect(tools).toMatchObject({ bash: false, webfetch: false, task: false });
    expect(permissions['*']).toBe('deny');
    expect(Object.values(permissions).every((v) => v === 'deny')).toBe(true);
    expect(config.mcp).toEqual({});
    // read stays offered (free-tier requirement) but only a never-existing file is allowed
    expect(readTool).toBe(true);
    expect(readPermission['*']).toBe('deny');
    expect(Object.entries(readPermission).filter(([, v]) => v === 'allow')).toEqual([['xc-no-such-file.never', 'allow']]);

    // one Gemini request per run: no extra session-title / summary call on another model's quota
    expect(config.agent).toEqual({ title: { disable: true }, summary: { disable: true } });
  });
});

describe('parseOpencodeEvents', () => {
  it('extracts the final text from the sample', () => {
    const text = parseOpencodeEvents(sample);
    expect(text.ok).toBe(true);
    const reply = text.ok ? parseTriageReply(text.value, known) : null;
    expect(reply?.ok && reply.value.items.map((i) => i.statusId)).toEqual(['1001', '1002']);
  });

  it('fails without a final step_finish event', () => {
    const out = events({ type: 'text', part: { text: '[]' } });
    expect(parseOpencodeEvents(out).ok).toBe(false);
  });

  it('a tool-calls finish is not final', () => {
    const out = events({ type: 'text', part: { text: '[]' } }, { type: 'step_finish', part: { reason: 'tool-calls' } });
    expect(parseOpencodeEvents(out).ok).toBe(false);
  });

  it('keeps only the final step text after a denied tool call', () => {
    const denied = { type: 'tool_use', part: { tool: 'read', state: { status: 'error' } } };
    const out = events(
      { type: 'step_start', part: {} },
      { type: 'text', part: { text: 'Let me read [x]' } },
      denied,
      { type: 'step_finish', part: { reason: 'tool-calls' } },
      { type: 'step_start', part: {} },
      { type: 'text', part: { text: '[]' } },
      finish,
    );
    expect(parseOpencodeEvents(out)).toEqual({ ok: true, value: '[]' });
  });

  it('surfaces the provider error from an error event (live 403 free-tier shape)', () => {
    const error = { name: 'APIError', data: { message: 'free tier can only be used from within OpenCode', statusCode: 403 } };
    expect(parseOpencodeEvents(events({ type: 'error', error }))).toEqual({
      ok: false,
      error: 'opencode error: APIError: free tier can only be used from within OpenCode',
    });
  });

  it('fails closed when a tool actually ran', () => {
    const ran = { type: 'tool_use', part: { tool: 'bash', state: { status: 'completed' } } };
    expect(parseOpencodeEvents(events(ran, { type: 'text', part: { text: '[]' } }, finish)).ok).toBe(false);
  });

  it('fails on error events and on empty text; ignores noise lines', () => {
    expect(parseOpencodeEvents(events({ type: 'error', error: {} }, finish)).ok).toBe(false);
    expect(parseOpencodeEvents(events(finish)).ok).toBe(false);
    const noisy = `warming up\n${events({ type: 'text', part: { text: 'x' } }, finish)}`;
    expect(parseOpencodeEvents(noisy)).toEqual({ ok: true, value: 'x' });
  });
});

describe('extractJson / parseTriageReply', () => {
  it('parses fenced and unfenced arrays', () => {
    const body = JSON.stringify([item('1001')]);
    expect(extractJson('```json\n' + body + '\n```').ok).toBe(true);
    expect(extractJson('Here you go: ' + body + ' done').ok).toBe(true);
    expect(extractJson('no json here').ok).toBe(false);
  });

  it('falls back to a self-corrected last array (live-observed)', () => {
    const bad = JSON.stringify([item('1001')]).replace('}]', '');
    const fixed = JSON.stringify([item('1001', { score: 40 })]);
    const result = parseTriageReply(`${bad}]\n\nWait, format error. Let me correct.\n\n${fixed}`, known);
    expect(result.ok && result.value.items[0]?.score).toBe(40);
  });

  it('treats a missing roughDraft as empty (live-observed)', () => {
    const { roughDraft: _omitted, ...noDraft } = item('1001');
    const result = parseTriageReply(JSON.stringify([noDraft]), known);
    expect(result.ok && result.value.items[0]?.roughDraft).toBe('');
  });

  it('drops unknown and duplicate ids', () => {
    const text = JSON.stringify([item('1001'), item('9999'), item('1001', { score: 5 })]);
    const result = parseTriageReply(text, known);
    expect(result.ok && result.value.items).toHaveLength(1);
    expect(result.ok && result.value.items[0]?.score).toBe(70);
  });

  it('flags schema-invalid known items instead of accepting them', () => {
    const text = JSON.stringify([item('1001', { score: 500 }), item('1002', { roughDraft: 'x'.repeat(281) })]);
    const result = parseTriageReply(text, known);
    expect(result.ok && result.value.items).toEqual([]);
    expect(result.ok && result.value.invalidIds).toEqual(['1001', '1002']);
  });

  it('rejects non-array and malformed output', () => {
    expect(parseTriageReply('{"a":1}', known).ok).toBe(false);
    expect(parseTriageReply('[not json]', known).ok).toBe(false);
  });
});
