import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig, err, IdeaGenerateRequestSchema, ok } from '@xc/shared';
import { openDb } from '../db';
import { createJobRegistry } from '../jobs';
import { ingestPosts } from '../posts';
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
      kind: 'spacehub',
      source: null,
      sourceIds: [],
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

  it('records its steps on the job: context, the model with each retry wait, the check and the save', async () => {
    const jobs = createJobRegistry();
    const job = jobs.start('idea-steps-01', { kind: 'compose-idea', key: 'compose', target: { type: 'compose' } });
    const labels: string[] = [];
    const answers = [err('503 high demand'), ok(ideaReply('kept'))];
    const service = createSingleIdeaService(freshDb(), config(), async (_prompt, observer) => {
      observer?.onModel?.('google/flash-lite');
      return answers.shift() ?? ok('');
    }, {
      productContext: async () => '',
      wait: async () => void labels.push(jobs.view('idea-steps-01')?.steps.at(-1)?.detail ?? ''),
    });
    expect(await service.generate(undefined, undefined, job)).toMatchObject({ status: 'ok' });
    expect(labels).toEqual(['flash-lite under high demand, retrying in 10s']);
    expect(jobs.view('idea-steps-01')?.steps.map((s) => s.label)).toEqual([
      'Building context (product notes, recent posts and ideas)',
      'Asking flash-lite (attempt 2)',
      'Checking the idea',
      'Saving the idea',
    ]);
  });

  it('refuses without a model, while paused or busy on the same target (another post runs alongside), and reports a failure without saving', async () => {
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
    const otherPost = slow.generate('inspired', { statusId: '77', authorHandle: 'someone', text: 'a different post' });
    expect(await slow.generate()).toEqual({ status: 'busy' });
    release();
    expect(await first).toMatchObject({ status: 'ok' });
    expect(await otherPost).toMatchObject({ status: 'ok' });

    const failing = createSingleIdeaService(db, config(), async () => err('fake failure'), { productContext: async () => '', wait: noWait });
    expect(await failing.generate()).toMatchObject({ status: 'failed', kind: 'cli', resumesAt: null });
    expect(readDigestView(db).digest?.ideas.map((i) => i.text)).toEqual(['slow']);
  });
});

describe('single idea kinds', () => {
  const capture = (statusId: string, handle: string) => ({
    statusId, authorName: handle, authorHandle: handle, text: `crypto take ${statusId}`, postedAt: new Date().toISOString(),
    metrics: { replies: 1, reposts: 1, likes: 9, views: 50 }, isReply: false, replyTo: [], quotedStatusId: null, avatarUrl: null,
  });
  // Answers every prompt by citing the first offered source post.
  const citingModel = async (prompt: string) => {
    const id = /<source-posts>\n\[\{"statusId":"(\d+)"/.exec(prompt)?.[1];
    return ok(JSON.stringify([{ ideas: [{ text: 'an idea', feature: 'f', kind: 'spacehub', sourceIds: id ? [id] : [] }] }]));
  };

  it('a quote idea comes from a fresh non-own post, never the same one twice, and refuses once none is left', async () => {
    const db = freshDb();
    ingestPosts(db, [capture('21', 'alice'), capture('22', 'me')], Date.now(), 'me');
    const service = createSingleIdeaService(db, config(), citingModel, { productContext: async () => '', wait: noWait });
    expect(await service.generate('quote')).toMatchObject({
      status: 'ok',
      idea: { kind: 'quote', sourceIds: ['21'], source: { statusId: '21', url: 'https://x.com/alice/status/21', authorHandle: 'alice' } },
    });
    expect(await service.generate('quote')).toEqual({ status: 'no_source' });
    expect(await service.generate('eco')).toMatchObject({ status: 'ok', idea: { kind: 'eco', source: null } });
  });

  it('with no kind, rotates kinds without spacehub twice in a row', async () => {
    const db = freshDb();
    ingestPosts(db, ['31', '32', '33', '34', '35'].map((id) => capture(id, 'bob')), Date.now(), 'me');
    const service = createSingleIdeaService(db, config(), citingModel, { productContext: async () => '', wait: noWait });
    const kinds: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const outcome = await service.generate();
      if (outcome.status === 'ok') kinds.push(outcome.idea.kind);
    }
    expect(kinds).toEqual(['spacehub', 'eco', 'inspired', 'quote', 'spacehub', 'eco']);
  });
});

describe('single idea for a picked post', () => {
  const capture = (statusId: string, handle: string, text: string) => ({
    statusId, authorName: handle, authorHandle: handle, text, postedAt: new Date().toISOString(),
    metrics: { replies: 1, reposts: 1, likes: 9, views: 50 }, isReply: false, replyTo: [], quotedStatusId: null, avatarUrl: null,
  });
  const sourceBlock = (prompt: string) => /<source-posts>\n(.*)\n<\/source-posts>/.exec(prompt)?.[1];

  it('uses only the picked post: the stored text when captured (by id, or by author and text), else the DOM text', async () => {
    const db = freshDb();
    ingestPosts(db, [capture('41', 'alice', 'stored take'), capture('42', 'bob', 'best ranked crypto take'), capture('43', 'dave', 'quoted words')], Date.now(), 'me');
    const prompts: string[] = [];
    const model = async (prompt: string) => {
      prompts.push(prompt);
      return ok(JSON.stringify([{ ideas: [{ text: 'an idea', feature: 'f', sourceIds: ['42'] }] }]));
    };
    const service = createSingleIdeaService(db, config(), model, { productContext: async () => '', wait: noWait });

    expect(await service.generate('inspired', { statusId: '41', authorHandle: 'alice', text: 'dom text' })).toMatchObject({
      status: 'ok',
      idea: { kind: 'inspired', sourceIds: ['41'], source: { statusId: '41', url: 'https://x.com/alice/status/41', excerpt: 'stored take' } },
    });
    expect(sourceBlock(prompts[0] ?? '')).toBe('[{"statusId":"41","author":"alice","excerpt":"stored take"}]');

    expect(await service.generate('quote', { statusId: null, authorHandle: 'dave', text: 'quoted words' })).toMatchObject({
      status: 'ok',
      idea: { kind: 'quote', source: { statusId: '43', url: 'https://x.com/dave/status/43' } },
    });

    expect(await service.generate('quote', { statusId: null, authorHandle: 'erin', text: 'never captured' })).toMatchObject({
      status: 'ok',
      idea: { kind: 'quote', sourceIds: [], source: { statusId: null, url: null, authorHandle: 'erin', excerpt: 'never captured' } },
    });
    expect(sourceBlock(prompts[2] ?? '')).toBe('[{"statusId":null,"author":"erin","excerpt":"never captured"}]');
  });

  it('accepts a source only with kind inspired or quote', () => {
    const source = { authorHandle: 'alice', text: 'hi' };
    expect(IdeaGenerateRequestSchema.safeParse({ kind: 'quote', source }).success).toBe(true);
    expect(IdeaGenerateRequestSchema.safeParse({ kind: 'eco', source }).success).toBe(false);
    expect(IdeaGenerateRequestSchema.safeParse({ source }).success).toBe(false);
    expect(IdeaGenerateRequestSchema.safeParse({ kind: 'quote', source: { authorHandle: 'alice', text: '  ' } }).success).toBe(false);
  });
});
