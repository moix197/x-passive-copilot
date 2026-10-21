import { describe, expect, it } from 'vitest';
import { createDigestProgress, createModelReporter, FINISHED_VISIBLE_MS } from './progress';

const LABELS = { collect: 'Collecting', context: 'Reading', model: 'Asking the model', save: 'Saving ideas' };

function setup() {
  let clock = 1000;
  const progress = createDigestProgress(LABELS, () => clock);
  return { progress, tick: (ms: number) => (clock += ms) };
}

const states = (view: ReturnType<ReturnType<typeof createDigestProgress>['view']>) => view?.steps.map((s) => s.state);

describe('digest progress', () => {
  it('is null before any run, then marks earlier steps done and the given one current', () => {
    const { progress, tick } = setup();
    expect(progress.view()).toBeNull();
    progress.start();
    progress.step('collect', 'Collecting recent posts (3)');
    progress.step('context');
    tick(2500);
    const view = progress.view();
    expect(states(view)).toEqual(['done', 'current', 'pending', 'pending']);
    expect(view?.steps[0]?.label).toBe('Collecting recent posts (3)');
    expect(view).toMatchObject({ startedAt: 1000, elapsedMs: 2500, outcome: null });
  });

  it('reports model, quota switch and retry waits on the model step', () => {
    const { progress } = setup();
    progress.start();
    progress.step('model');
    const report = createModelReporter(progress);
    const observer = report.nextAttempt();
    observer.onModel?.('google/gemini-flash');
    expect(progress.view()?.steps[2]).toMatchObject({ label: 'Asking gemini-flash (attempt 1)', detail: null });
    observer.onSwitch?.('google/gemini-flash', 'google/gemini-lite');
    observer.onModel?.('google/gemini-lite');
    expect(progress.view()?.steps[2]).toMatchObject({
      label: 'Asking gemini-lite (attempt 1)',
      detail: 'Quota reached on gemini-flash, switching to gemini-lite',
    });
    report.failed('503 high demand');
    report.retrying(10_000);
    expect(progress.view()?.steps[2]?.detail).toBe('gemini-lite under high demand, retrying in 10s');
    report.nextAttempt().onModel?.('google/gemini-lite');
    expect(progress.view()?.steps[2]).toMatchObject({ label: 'Asking gemini-lite (attempt 2)', detail: null });
  });

  it('finishes done or failed, freezes elapsed time and hides the run after the visible window', () => {
    const { progress, tick } = setup();
    progress.start();
    progress.step('model');
    tick(4000);
    progress.finish({ ok: true, ideas: 3 });
    tick(1000);
    expect(progress.view()).toMatchObject({ elapsedMs: 4000, outcome: { ok: true, ideas: 3 } });
    expect(states(progress.view())).toEqual(['done', 'done', 'done', 'done']);
    tick(FINISHED_VISIBLE_MS);
    expect(progress.view()).toBeNull();

    progress.start();
    progress.step('model');
    progress.finish({ ok: false, reason: 'quota' });
    expect(states(progress.view())).toEqual(['done', 'done', 'failed', 'pending']);
  });

  it('close() ends a run left open by a thrown error and leaves finished runs alone', () => {
    const { progress } = setup();
    progress.start();
    progress.step('context');
    progress.close();
    expect(progress.view()?.outcome).toMatchObject({ ok: false });
    expect(states(progress.view())).toEqual(['done', 'failed', 'pending', 'pending']);
  });
});
