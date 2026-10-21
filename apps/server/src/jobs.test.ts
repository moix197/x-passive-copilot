import { describe, expect, it } from 'vitest';
import { createJobRegistry, JOB_SLOW_MS } from './jobs';

function setup() {
  let clock = 1000;
  const jobs = createJobRegistry(() => clock);
  return { jobs, tick: (ms: number) => (clock += ms) };
}

const states = (view: ReturnType<ReturnType<typeof createJobRegistry>['view']>) => view?.steps.map((s) => `${s.id}:${s.state}`);

describe('job registry', () => {
  it('appends steps as the work goes, and a repeated step id becomes current again with later steps reset', () => {
    const { jobs, tick } = setup();
    const job = jobs.start('idea-abcdefgh');
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
    const job = jobs.start('polish-1');
    job.step('model', 'Polishing');
    tick(JOB_SLOW_MS + 1);
    expect(jobs.view('polish-1')?.slow).toBe(true);
    job.finish({ ok: false, reason: 'timeout' });
    tick(5000);
    expect(jobs.view('polish-1')).toMatchObject({ slow: false, elapsedMs: JOB_SLOW_MS + 1, outcome: { ok: false, reason: 'timeout', resumesAt: null } });
    expect(states(jobs.view('polish-1'))).toEqual(['model:failed']);
  });

  it('keeps the first outcome, close() fails only an open job, and finished jobs are forgotten after ten minutes', () => {
    const { jobs, tick } = setup();
    const done = jobs.start('polish-2');
    done.step('save', 'Saving');
    done.finish({ ok: true });
    done.close();
    expect(jobs.view('polish-2')?.outcome).toEqual({ ok: true });
    const open = jobs.start('polish-3');
    open.close();
    expect(jobs.view('polish-3')?.outcome).toMatchObject({ ok: false });
    tick(10 * 60_000 + 1);
    expect(jobs.view('polish-2')).toBeNull();
    expect(jobs.view('unknown')).toBeNull();
  });
});
