import { describe, expect, it } from 'vitest';
import { MAX_LISTED_JOBS } from '@xc/shared';
import { createJobRegistry, FINISHED_KEEP_MS, JOB_SLOW_MS, type JobMeta } from './jobs';

const META: JobMeta = { kind: 'compose-idea', key: 'compose', target: { type: 'compose' } };

function setup() {
  let clock = 1000;
  const jobs = createJobRegistry(() => clock);
  return { jobs, tick: (ms: number) => (clock += ms) };
}

const states = (view: ReturnType<ReturnType<typeof createJobRegistry>['view']>) => view?.steps.map((s) => `${s.id}:${s.state}`);

describe('job registry', () => {
  it('appends steps as the work goes, and a repeated step id becomes current again with later steps reset', () => {
    const { jobs, tick } = setup();
    const job = jobs.start('idea-abcdefgh', META);
    job.step('queued', 'Queued');
    job.step('model', 'Asking m (attempt 1)');
    job.step('check', 'Checking the idea');
    job.note('unreadable');
    job.step('model', 'Asking m (attempt 2)');
    tick(1500);
    const view = jobs.view('idea-abcdefgh');
    expect(states(view)).toEqual(['queued:done', 'model:current', 'check:pending']);
    expect(view).toMatchObject({ elapsedMs: 1500, slow: false, outcome: null });
    expect(view?.steps[1]).toMatchObject({ label: 'Asking m (attempt 2)', detail: null });
    expect(view?.steps[2]?.detail).toBeNull();
  });

  it('flags a job running past the slow mark, and freezes elapsed time once finished', () => {
    const { jobs, tick } = setup();
    const job = jobs.start('polish-1', META);
    job.step('model', 'Polishing');
    tick(JOB_SLOW_MS + 1);
    expect(jobs.view('polish-1')?.slow).toBe(true);
    job.finish({ ok: false, reason: 'timeout' });
    tick(5000);
    expect(jobs.view('polish-1')).toMatchObject({ slow: false, elapsedMs: JOB_SLOW_MS + 1, outcome: { ok: false, reason: 'timeout', resumesAt: null } });
    expect(states(jobs.view('polish-1'))).toEqual(['model:failed']);
  });

  it('keeps the first outcome, close() fails only an open job, and finished jobs are forgotten after a day', () => {
    const { jobs, tick } = setup();
    const done = jobs.start('polish-2', META);
    done.step('save', 'Saving');
    done.finish({ ok: true });
    done.close();
    expect(jobs.view('polish-2')?.outcome).toEqual({ ok: true });
    const open = jobs.start('polish-3', META);
    open.close();
    expect(jobs.view('polish-3')?.outcome).toMatchObject({ ok: false });
    tick(FINISHED_KEEP_MS + 1);
    expect(jobs.view('polish-2')).toBeNull();
    expect(jobs.view('unknown')).toBeNull();
  });

  it('lists newest first with what each job is for, finds a running job by key, and keeps a bounded history', () => {
    const { jobs, tick } = setup();
    const running = jobs.start('idea-running1', { kind: 'post-idea', key: 'post-idea:1', target: { type: 'post', statusId: '1', authorHandle: 'a', text: 't' }, ideaKind: 'inspired' });
    for (let i = 0; i < MAX_LISTED_JOBS + 5; i += 1) {
      tick(1);
      jobs.start(`polish-${i}`, META).finish({ ok: true, result: { type: 'draft', draftKey: String(i), versionId: i, text: 'v' } });
    }
    const list = jobs.list();
    expect(list).toHaveLength(MAX_LISTED_JOBS);
    expect(list[0]).toMatchObject({ id: `polish-${MAX_LISTED_JOBS + 4}`, result: { type: 'draft', text: 'v' } });
    expect(list.some((j) => j.id === 'idea-running1')).toBe(true);
    expect(jobs.running('post-idea:1')).toMatchObject({ id: 'idea-running1', kind: 'post-idea', ideaKind: 'inspired', finishedAt: null });
    running.finish({ ok: true });
    expect(jobs.running('post-idea:1')).toBeNull();
  });
});
