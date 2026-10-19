import { DIGEST_STEP_IDS, type DigestProgress, type DigestStep, type DigestStepId, type ModelFailureKind } from '@xc/shared';
import type { ModelObserver } from '../llm/model-pool';
import { classifyFailure } from '../triage/retry';

/** A finished run stays visible this long so the panel can show its outcome before hiding it. */
export const FINISHED_VISIBLE_MS = 6000;

type Outcome = NonNullable<DigestProgress['outcome']>;

export interface DigestProgressTracker {
  start(): void;
  /** Makes `id` the current step (earlier ones done) and sets its label; keeps the detail line. */
  step(id: DigestStepId, label?: string): void;
  /** What the current step waits on; null clears it. */
  note(detail: string | null): void;
  finish(outcome: Outcome): void;
  /** Ends a run that threw before reporting an outcome, so the panel never shows it running forever. */
  close(): void;
  view(): DigestProgress | null;
}

interface Run {
  startedAt: number;
  finishedAt: number | null;
  steps: DigestStep[];
  outcome: Outcome | null;
}

function freshSteps(labels: Record<DigestStepId, string>): DigestStep[] {
  return DIGEST_STEP_IDS.map((id) => ({ id, label: labels[id], state: 'pending', detail: null }));
}

function advanceTo(steps: DigestStep[], id: DigestStepId): void {
  const at = steps.findIndex((s) => s.id === id);
  steps.forEach((s, i) => {
    if (i < at) s.state = 'done';
    else if (i === at) s.state = 'current';
  });
}

function settle(steps: DigestStep[], ok: boolean): void {
  for (const s of steps) {
    if (s.state === 'current') s.state = ok ? 'done' : 'failed';
  }
}

export function createDigestProgress(labels: Record<DigestStepId, string>, now: () => number): DigestProgressTracker {
  let run: Run | null = null;
  const current = () => run?.steps.find((s) => s.state === 'current');

  function view(): DigestProgress | null {
    if (!run) return null;
    const end = run.finishedAt ?? now();
    if (run.finishedAt !== null && now() - run.finishedAt > FINISHED_VISIBLE_MS) return null;
    const steps = run.steps.map((s) => ({ ...s }));
    return { startedAt: run.startedAt, elapsedMs: Math.max(0, end - run.startedAt), steps, outcome: run.outcome };
  }

  function finish(outcome: Outcome): void {
    if (!run) return;
    if (outcome.ok) advanceTo(run.steps, 'save');
    settle(run.steps, outcome.ok);
    run.outcome = outcome;
    run.finishedAt = now();
  }

  return {
    start() {
      run = { startedAt: now(), finishedAt: null, steps: freshSteps(labels), outcome: null };
    },
    step(id, label) {
      if (!run) return;
      advanceTo(run.steps, id);
      const step = current();
      if (step && label) step.label = label;
    },
    note(detail) {
      const step = current();
      if (step) step.detail = detail;
    },
    finish,
    close() {
      if (run && run.finishedAt === null) finish({ ok: false, reason: 'the digest run stopped unexpectedly (see the server log)' });
    },
    view,
  };
}

const shortModel = (model: string) => model.slice(model.lastIndexOf('/') + 1);

const RETRY_REASON: Partial<Record<ModelFailureKind, string>> = {
  busy: 'busy',
  timeout: 'timed out',
  malformed: 'answered in an unreadable format',
};

export interface ModelReporter {
  /** Starts the next attempt and returns the observer for its pool call. */
  nextAttempt(): ModelObserver;
  failed(error: string): void;
  retrying(delayMs: number): void;
}

/** Turns model-pool events and retry waits into the "Asking <model>" step and its detail line. */
export function createModelReporter(progress: DigestProgressTracker): ModelReporter {
  let attempt = 0;
  let model = '';
  let lastKind: ModelFailureKind = 'cli';
  const observer: ModelObserver = {
    onModel(next) {
      model = next;
      progress.step('model', `Asking ${shortModel(model)} (attempt ${attempt})`);
    },
    onSwitch(from, next) {
      const then = next ? `switching to ${shortModel(next)}` : 'no model left';
      progress.note(`Quota reached on ${shortModel(from)}, ${then}`);
    },
  };
  return {
    nextAttempt() {
      attempt += 1;
      progress.note(null);
      return observer;
    },
    failed(error) {
      lastKind = classifyFailure(error);
    },
    retrying(delayMs) {
      const why = RETRY_REASON[lastKind] ?? 'failed';
      progress.note(`${shortModel(model) || 'Model'} ${why}, retrying in ${Math.round(delayMs / 1000)}s`);
    },
  };
}
