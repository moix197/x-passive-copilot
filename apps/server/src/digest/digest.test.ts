import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig, err, ok } from '@xc/shared';
import { openDb } from '../db';
import { ingestPosts } from '../posts';
import { bucketToRun, createDigestService, getIdea, readDigestView, sanitizeDigest } from './digest';

const metrics = { replies: 0, reposts: 0, likes: 0, views: 0 };
const post = (n: number, handle: string) => ({
  statusId: String(n), authorName: 'A', authorHandle: handle, text: `post ${n}`, postedAt: null, metrics,
  isReply: false, quotedStatusId: null,
});
const config = () => ({ ...defaultConfig(), handle: 'me', models: { triage: 'm', final: '' } });
const reply = (ids: string[]) =>
  JSON.stringify([{ trends: [{ title: 't', summary: 's', statusIds: ids }], ideas: [{ text: 'idea one', feature: 'f' }] }]);
const freshDb = () => openDb(mkdtempSync(join(tmpdir(), 'xc-digest-')));

function addPosts(db: ReturnType<typeof openDb>, from: number, to: number, handle = 'someone') {
  const posts = Array.from({ length: to - from + 1 }, (_, i) => post(from + i, handle));
  ingestPosts(db, posts, 1, 'me');
}

describe('bucketToRun', () => {
  it('fires once per bucket of N and never twice for the same bucket', () => {
    expect(bucketToRun(49, 50, 0)).toBeNull();
    expect(bucketToRun(50, 50, 0)).toBe(1);
    expect(bucketToRun(99, 50, 1)).toBeNull();
    expect(bucketToRun(100, 50, 1)).toBe(2);
    expect(bucketToRun(120, 50, 2)).toBeNull();
  });
});

describe('sanitizeDigest', () => {
  it('drops unknown statusIds and rejects empty output', () => {
    const raw = { trends: [{ title: 't', summary: 's', statusIds: ['1', '999', '1'] }], ideas: [] };
    expect(sanitizeDigest(raw, new Set(['1']))?.trends[0]?.statusIds).toEqual(['1']);
    expect(sanitizeDigest({ trends: [], ideas: [] }, new Set())).toBeNull();
    expect(sanitizeDigest('nope', new Set())).toBeNull();
  });
});

describe('digest service', () => {
  it('runs once per 50 non-own posts, ignoring own posts, idempotent on repeat', async () => {
    const db = freshDb();
    let calls = 0;
    const model = async () => {
      calls += 1;
      return ok(reply(['1', '777']));
    };
    const service = createDigestService(db, config(), model, () => '');
    addPosts(db, 1, 49);
    addPosts(db, 500, 520, 'me');
    await service.run();
    expect(calls).toBe(0);
    addPosts(db, 50, 50);
    await service.run();
    await service.run();
    expect(calls).toBe(1);
    const view = readDigestView(db);
    expect(view.digest?.trends[0]?.statusIds).toEqual(['1']);
    expect(getIdea(db, view.digest?.ideas[0]?.id ?? '')).toEqual({ text: 'idea one', feature: 'f' });
    addPosts(db, 51, 100);
    await service.run();
    expect(calls).toBe(2);
  });

  it('keeps the previous digest and sets the failed flag when generation fails', async () => {
    const db = freshDb();
    let fail = false;
    const model = async () => (fail ? err('malformed output') : ok(reply(['1'])));
    const service = createDigestService(db, config(), model, () => '');
    addPosts(db, 1, 50);
    await service.run();
    fail = true;
    addPosts(db, 51, 100);
    await service.run();
    const view = readDigestView(db);
    expect(view.failed).toBe(true);
    expect(view.digest?.trends).toHaveLength(1);
  }, 60_000);
});
