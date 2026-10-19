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
    const idea = { subject: { kind: 'idea' as const, idea: { text: 'i', feature: 'f' } }, previous: null, alternatives: [] };
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
