import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StoredPost } from '@xc/shared';
import { describe, expect, it } from 'vitest';
import { buildPolishPrompt } from '../polish/polish';
import { buildTriagePrompt, NO_STYLE } from './prompts';

const NO_PITCH = 'DON\'T: pitch, plug or mention Acme, "our platform", "our tool", "we built something for this"';
const BAD_EXAMPLE = 'Bad (a pitch): "We built Acme to track exactly this, check it out."';
const post = { statusId: '1', authorHandle: 'nora', text: 'How do you read LONG burn data?', triage: null } as unknown as StoredPost;
const systemAsset = readFileSync(join(import.meta.dirname, '../../assets/finalize-system.md'), 'utf8');

describe('reply tone rules', () => {
  it('reach the triage rough-draft prompt', () => {
    const prompt = buildTriagePrompt('', [post], new Map(), 'Acme');
    expect(prompt).toContain(`Rules for roughDraft:\nReplies to other people's posts`);
    expect(prompt).toContain(NO_PITCH);
    expect(prompt).toContain(BAD_EXAMPLE);
  });

  it('reach the reply polish prompt, which never points at product docs', () => {
    const prompt = buildPolishPrompt({ subject: { kind: 'post', post }, previous: null, alternatives: [] }, NO_STYLE, 'Acme');
    expect(prompt).toContain(NO_PITCH);
    expect(prompt).toContain(BAD_EXAMPLE);
    expect(prompt).toContain('Files you may read: `voice.md` (voice and tone).');
    expect(prompt).not.toContain('.ai/product');
    expect(prompt).not.toContain('build-in-public');
  });

  it('stay out of idea polish, which keeps build-in-public rules and product docs', () => {
    const idea = { subject: { kind: 'idea' as const, idea: { text: 'i', feature: 'f', kind: 'spacehub' as const, source: null, sourceIds: [] } }, previous: null, alternatives: [] };
    const prompt = buildPolishPrompt(idea, NO_STYLE, 'Acme');
    expect(prompt).toContain('Post ideas are build-in-public and educational, never promotional.');
    expect(prompt).toContain('`.ai/product/index.md` (what the product is)');
    expect(prompt).not.toContain(NO_PITCH);
  });

  it('are not overridden by the shared system asset, which names no product docs', () => {
    expect(systemAsset).not.toContain('.ai/product');
    expect(systemAsset).toContain('Read ONLY the files the input lists after "Files you may read:"');
    expect(systemAsset).toContain('Follow the tone rules given in the input');
  });
});

describe('reply tone rules content', () => {
  const rules = buildTriagePrompt('', [post], new Map(), 'Acme');

  it('ask for short, humble, kind, on-topic replies without invented facts', () => {
    expect(rules).toContain('SHORT: 1 or 2 sentences, conversational, about 200 characters at most.');
    expect(rules).toContain('HUMBLE: talk peer to peer. Never lecture');
    expect(rules).toContain('KIND: never insult, mock or label groups of people ("tourists", "normies", "paper hands"');
    expect(rules).toContain('ON TOPIC: stay on the post\'s own topic. No unrelated macro, regulation or market tangents.');
    expect(rules).toContain('NO INVENTED FACTS: never state market data, metrics, prices, volumes, liquidity or current conditions\nunless they appear in the post itself.');
    expect(rules).toContain('"roughDraft": string (max 200 chars, 1 or 2 sentences');
  });

  it('are echoed by the shared system asset', () => {
    expect(systemAsset).toContain('A reply is 1 or 2 short sentences (about 200 characters), humble and peer to peer, never a lecture.');
    expect(systemAsset).toContain('Never insult or label groups of people and never call anyone out.');
    expect(systemAsset).toContain('Never state market data, metrics or current conditions that are not in the input.');
  });
});
