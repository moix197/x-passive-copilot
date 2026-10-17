import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb } from '../db';
import { saveDraft } from '../polish/drafts-store';
import { ingestPosts } from '../posts';
import { listFeedbackExamples, recordFeedback } from './feedback';
import { parseProfile, shouldRegenerate } from './voice';

const freshDb = () => openDb(mkdtempSync(join(tmpdir(), 'xc-voice-')));
const metrics = { replies: 0, reposts: 0, likes: 0, views: 0 };
const post = (statusId: string, text: string) => ({
  statusId, authorName: 'A', authorHandle: 'someone', text, postedAt: null, metrics,
  isReply: false, replyTo: [], quotedStatusId: null,
});

describe('shouldRegenerate', () => {
  it('waits for minSamples, then every 10 new samples', () => {
    expect(shouldRegenerate(4, null, 5)).toBe(false);
    expect(shouldRegenerate(5, null, 5)).toBe(true);
    expect(shouldRegenerate(14, 5, 5)).toBe(false);
    expect(shouldRegenerate(15, 5, 5)).toBe(true);
  });
});

describe('parseProfile', () => {
  it('reads the single object out of the array and clips lists', () => {
    const reply = '[{"tone":"dry","length":"short","vocabulary":"plain","dos":["a","b","c","d","e","f"],"donts":[]}]';
    const result = parseProfile(reply);
    expect(result.ok && result.value.dos).toHaveLength(5);
  });

  it('rejects malformed output', () => {
    expect(parseProfile('[{"tone":1}]').ok).toBe(false);
  });
});

describe('recordFeedback', () => {
  function seedDraft(db: ReturnType<typeof freshDb>, text: string) {
    ingestPosts(db, [post('100', 'source post')], 1, 'me');
    saveDraft(db, { statusId: '100', kind: 'manual', status: 'ready', text, violations: [], error: null }, 1);
  }

  it('latest feedback per draft wins; down makes a negative example', () => {
    const db = freshDb();
    seedDraft(db, 'a fine reply');
    expect(recordFeedback(db, '100', { kind: 'up' }, 1).ok).toBe(true);
    expect(recordFeedback(db, '100', { kind: 'down' }, 2).ok).toBe(true);
    expect(listFeedbackExamples(db)).toEqual({ positives: [], negatives: ['a fine reply'] });
  });

  it('guard-checks edited text and rejects violations', () => {
    const db = freshDb();
    seedDraft(db, 'a fine reply');
    const bad = recordFeedback(db, '100', { kind: 'edit', text: 'to the moon, #a #b' }, 1);
    expect(bad).toMatchObject({ ok: false, status: 422 });
    expect(listFeedbackExamples(db).positives).toEqual([]);
  });

  it('copy or up on a draft that breaks the guard stores no positive example', () => {
    const db = freshDb();
    seedDraft(db, 'to the moon, #a #b');
    expect(recordFeedback(db, '100', { kind: 'copy' }, 1).ok).toBe(true);
    expect(recordFeedback(db, '100', { kind: 'up' }, 2).ok).toBe(true);
    expect(listFeedbackExamples(db).positives).toEqual([]);
    expect(recordFeedback(db, '100', { kind: 'down' }, 3).ok).toBe(true);
    expect(listFeedbackExamples(db).negatives).toEqual(['to the moon, #a #b']);
  });

  it('404s for an unknown draft', () => {
    expect(recordFeedback(freshDb(), '999', { kind: 'up' }, 1)).toMatchObject({ ok: false, status: 404 });
  });
});
