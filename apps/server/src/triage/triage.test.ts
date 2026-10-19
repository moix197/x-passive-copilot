import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig, err, type AppConfig } from '@xc/shared';
import { openDb } from '../db';
import { getPost, ingestPosts } from '../posts';
import { createTriageService } from './triage';
import { saveError } from './triage-store';

const HOUR = 3_600_000;
const NOW = Date.parse('2026-10-19T12:00:00Z');
const metrics = { replies: 0, reposts: 0, likes: 0, views: 0 };
const mention = (statusId: string, hoursAgo: number) => ({
  statusId, authorName: 'A', authorHandle: 'someone', text: 'hey @me', postedAt: new Date(NOW - hoursAgo * HOUR).toISOString(),
  metrics, isReply: false, replyTo: [], quotedStatusId: null, avatarUrl: null,
});
const config = (triage = 'm'): AppConfig => ({ ...defaultConfig(), handle: 'me', models: { triage, triageFallbacks: [], final: '' } });

function setup(post: ReturnType<typeof mention>, cfg = config()) {
  const db = openDb(mkdtempSync(join(tmpdir(), 'xc-triage-')));
  ingestPosts(db, [post], NOW, 'me');
  saveError(db, post.statusId, 'cli failed', 'mention', NOW);
  let classified = 0;
  const classify = async () => {
    classified += 1;
    return err('cli failed');
  };
  const service = createTriageService(db, cfg, classify, () => NOW);
  return { db, service, classified: () => classified };
}

describe('retriage', () => {
  it('clears the error row and re-runs triage for a fresh failed post', async () => {
    const { db, service, classified } = setup(mention('1', 2));
    expect(service.retriage('1')).toEqual({ status: 'queued', resumesAt: null });
    expect(getPost(db, '1')?.triage).toBeNull();
    expect(classified()).toBe(1);
  });

  it('refuses a post now past its age limit and keeps the error row', () => {
    const { db, service } = setup(mention('2', 80));
    expect(service.retriage('2')).toEqual({ status: 'skipped', reason: 'older than 72h' });
    expect(getPost(db, '2')?.triage?.error).toBe('cli failed');
  });

  it('answers unknown, not_failed and unavailable', () => {
    const { service } = setup(mention('3', 1));
    expect(service.retriage('404')).toEqual({ status: 'unknown' });
    const off = setup(mention('4', 1), config(''));
    expect(off.service.retriage('4')).toEqual({ status: 'unavailable' });
  });
});
