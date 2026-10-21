import type { PolishInfo, StoredPost, TriageInfo } from '@xc/shared/types';
import { describe, expect, it } from 'vitest';
import { canPolish, currentDraft, isTriagePending } from './current-draft';

const triage = (over: Partial<TriageInfo> = {}): TriageInfo => ({
  score: 80, reason: 'r', roughDraft: 'rough text', replyWorthy: true, skipReason: null,
  mustFlag: null, error: null, roughDraftWarnings: [], feedback: null, ...over,
});

const polish = (over: Partial<PolishInfo> = {}): PolishInfo => ({
  status: 'ready', text: 'claude text', violations: [], topPick: false, error: null,
  versions: [{ id: 1, text: 'claude text', status: 'ready', violations: [] }], selectedVersion: 1, feedback: null, ...over,
});

const post = (over: Partial<StoredPost> = {}): StoredPost => ({
  statusId: '42', authorName: 'A', authorHandle: 'a', text: 't', postedAt: null,
  metrics: { replies: 0, reposts: 0, likes: 0, views: 0 }, isReply: false, replyTo: [], quotedStatusId: null,
  avatarUrl: null, seq: 1, capturedAt: 0, repliedAt: null, copiedAt: null, manualFlaggedAt: null, triage: triage(), polish: null, ...over,
});

describe('currentDraft', () => {
  it('prefers the selected Claude version, with its own rating', () => {
    expect(currentDraft(post({ polish: polish({ feedback: 'up' }) }))).toEqual({
      kind: 'claude', text: 'claude text', draftId: '42', rating: 'up', busy: false,
    });
  });

  it('keeps showing the selected version while a regenerate runs', () => {
    expect(currentDraft(post({ polish: polish({ status: 'polishing' }) }))).toMatchObject({ kind: 'claude', busy: true });
  });

  it('falls back to the First draft when the Claude version is missing, polishing from scratch or failed', () => {
    const rough = { kind: 'rough', text: 'rough text', draftId: 'rough-42', rating: 'down', busy: false };
    const roughPost = (p: PolishInfo | null) => post({ triage: triage({ feedback: 'down' }), polish: p });
    expect(currentDraft(roughPost(null))).toEqual(rough);
    expect(currentDraft(roughPost(polish({ status: 'polishing', text: null })))).toEqual(rough);
    expect(currentDraft(roughPost(polish({ status: 'error', text: 'old' })))).toEqual(rough);
    expect(currentDraft(roughPost(polish({ status: 'cap_reached', text: null })))).toEqual(rough);
  });

  it('is null without any draft', () => {
    expect(currentDraft(post({ triage: triage({ roughDraft: null }) }))).toBeNull();
    expect(currentDraft(post({ triage: null }))).toBeNull();
  });
});

describe('canPolish', () => {
  it('allows triaged posts, and must-flag posts even when triage errored', () => {
    expect(canPolish(post())).toBe(true);
    expect(canPolish(post({ triage: triage({ error: 'x', mustFlag: 'mention' }) }))).toBe(true);
    expect(canPolish(post({ triage: triage({ error: 'x' }) }))).toBe(false);
    expect(canPolish(post({ triage: triage({ skipReason: 'own post' }) }))).toBe(false);
    expect(canPolish(post({ triage: null }))).toBe(false);
  });
});

describe('isTriagePending', () => {
  it('is true only for a flagged post with no verdict, error, skip or draft yet', () => {
    const pending = triage({ score: null, roughDraft: null, mustFlag: 'manual' });
    expect(isTriagePending(post({ triage: pending }))).toBe(true);
    expect(isTriagePending(post())).toBe(false);
    expect(isTriagePending(post({ triage: null }))).toBe(false);
    expect(isTriagePending(post({ triage: { ...pending, error: 'timeout' } }))).toBe(false);
    expect(isTriagePending(post({ triage: { ...pending, skipReason: 'own post' } }))).toBe(false);
  });
});
