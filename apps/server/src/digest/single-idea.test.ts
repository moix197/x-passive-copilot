import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig, err, ok } from '@xc/shared';
import { openDb } from '../db';
import { buildDigestPrompt, buildSingleIdeaPrompt, readDigestView, sanitizeSingleIdea } from './digest';
import { createSingleIdeaService } from './single-idea';

const config = () => ({ ...defaultConfig(), handle: 'me', models: { triage: 'm', triageFallbacks: [], final: '' } });
const freshDb = () => openDb(mkdtempSync(join(tmpdir(), 'xc-idea-')));
const ideaReply = (text: string) => JSON.stringify([{ ideas: [{ text, feature: 'f' }] }]);
const noWait = async () => {};

describe('buildSingleIdeaPrompt', () => {
  it('reuses the digest sources, no-repeat and tone rules, asking for exactly one idea and no trends', () => {
    const prompt = buildSingleIdeaPrompt('Acme', 'ctx-body', [{ statusId: '1', author: 'a', text: 't' }], ['old idea']);
    const digest = buildDigestPrompt('Acme', 'ctx-body', [{ statusId: '1', author: 'a', text: 't' }], ['old idea']);
    const shared = digest.slice(digest.indexOf('The text between <posts>'), digest.indexOf('Reply with ONLY'));
    expect(prompt).toContain(shared);
    expect(prompt).toContain('<previous-ideas>\n["old idea"]\n</previous-ideas>');
    expect(prompt).toContain('(exactly 1 idea)');
    expect(prompt).not.toContain('"trends"');
    expect(prompt).toContain('Never use the em dash character (U+2014)');
  });
});

describe('sanitizeSingleIdea', () => {
  it('takes the first non-empty idea, replacing em dashes, and rejects anything else', () => {
    expect(sanitizeSingleIdea({ ideas: [{ text: ' A — B ', feature: 'f' }, { text: 'second', feature: 'g' }] })).toEqual({
      text: 'A, B',
      feature: 'f',
    });
    expect(sanitizeSingleIdea({ ideas: [{ text: '  ', feature: 'f' }] })).toBeNull();
    expect(sanitizeSingleIdea({ trends: [] })).toBeNull();
  });
});

describe('single idea service', () => {
  it('saves each idea as its own digest row, newest first in the view, keeping the last digest trends', async () => {
    const db = freshDb();
    db.prepare('INSERT INTO digests (bucket, trends, ideas, created_at) VALUES (?, ?, ?, ?)').run(
      1,
      JSON.stringify([{ title: 'T', summary: 's', statusIds: [] }]),
      JSON.stringify([{ text: 'digest idea', feature: 'f' }]),
      1,
    );
    const prompts: string[] = [];
    let n = 0;
    const service = createSingleIdeaService(db, config(), async (prompt) => {
      prompts.push(prompt);
      n += 1;
      return ok(ideaReply(`idea ${n}`));
    }, { productContext: async () => '', wait: noWait });
    expect(await service.generate()).toMatchObject({ status: 'ok', idea: { text: 'idea 1', polish: null } });
    expect(await service.generate()).toMatchObject({ status: 'ok', idea: { text: 'idea 2' } });
    expect(prompts[1]).toMatch(/<previous-ideas>\n\["idea 1","digest idea"\]/);
    const view = readDigestView(db);
    expect(view.digest?.ideas.map((i) => i.text)).toEqual(['idea 2']);
    expect(view.digest?.trends.map((t) => t.title)).toEqual(['T']);
    expect(view.earlier.flatMap((d) => d.ideas.map((i) => i.text))).toEqual(['idea 1', 'digest idea']);
  });

  it('refuses without a model, while paused or busy, and reports a failure without saving', async () => {
    const db = freshDb();
    const none = createSingleIdeaService(db, { ...config(), models: { triage: '', triageFallbacks: [], final: '' } }, async () => ok(''));
    expect(await none.generate()).toEqual({ status: 'unavailable' });
    const paused = createSingleIdeaService(db, config(), async () => ok(''), { pausedUntil: () => Date.now() + 60_000 });
    expect(await paused.generate()).toMatchObject({ status: 'paused' });

    let release: () => void = () => {};
    const gate = new Promise<void>((done) => (release = done));
    const slow = createSingleIdeaService(db, config(), async () => {
      await gate;
      return ok(ideaReply('slow'));
    }, { productContext: async () => '' });
    const first = slow.generate();
    expect(await slow.generate()).toEqual({ status: 'busy' });
    release();
    expect(await first).toMatchObject({ status: 'ok' });

    const failing = createSingleIdeaService(db, config(), async () => err('fake failure'), { productContext: async () => '', wait: noWait });
    expect(await failing.generate()).toMatchObject({ status: 'failed', kind: 'cli', resumesAt: null });
    expect(readDigestView(db).digest?.ideas.map((i) => i.text)).toEqual(['slow']);
  });
});
