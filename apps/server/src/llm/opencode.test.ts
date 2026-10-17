// The fixture is derived from opencode's documented `run --format json` shape, NOT recorded from a
// live install (opencode was unavailable). Re-record with a real run and re-check these tests.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractJson, parseOpencodeEvents, parseTriageReply } from './opencode';

const sample = readFileSync(join(import.meta.dirname, '../../../../fixtures/opencode-run.jsonl'), 'utf8');
const known = new Set(['1001', '1002']);
const item = (statusId: string, extra: object = {}) => ({
  statusId, relevant: true, replyWorthy: true, score: 70, reason: 'r', roughDraft: 'd', ...extra,
});
const events = (...lines: object[]) => lines.map((l) => JSON.stringify(l)).join('\n');
const finish = { type: 'step_finish', part: { reason: 'stop' } };

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
