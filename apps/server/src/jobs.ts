import type { JobProgress, JobStep } from '@xc/shared';

/** Past this a running job shows "taking longer than usual" (a retry after high demand alone waits 10s, then 20s). */
export const JOB_SLOW_MS = 90_000;
/** A finished job stays readable this long, so a client polling slowly still sees how it ended. */
const FINISHED_KEEP_MS = 10 * 60_000;
const MAX_JOBS = 100;

type Outcome = NonNullable<JobProgress['outcome']>;
type FailedOutcome = Extract<Outcome, { ok: false }>;

export interface JobTracker {
  /**
   * Makes `id` the current step with this label: an existing step is reused (an earlier attempt of it, later
   * steps reset), a new one is appended; the previous steps count as done.
   */
  step(id: string, label: string): void;
  /** What the current step waits on (a retry, a model switch); null clears it. */
  note(detail: string | null): void;
  finish(outcome: { ok: true } | { ok: false; reason: string; resumesAt?: number | null }): void;
  /** Fails a job that ended without an outcome (it threw), so no client watches it forever. */
  close(): void;
}

export interface JobRegistry {
  /** A fresh job under this id (an older one with the same id is replaced). */
  start(id: string): JobTracker;
  view(id: string): JobProgress | null;
}

interface Job {
  id: string;
  startedAt: number;
  finishedAt: number | null;
  steps: JobStep[];
  outcome: Outcome | null;
}

/** For callers that run without anyone watching (auto polish, unit tests). */
export const NO_JOB: JobTracker = { step: () => undefined, note: () => undefined, finish: () => undefined, close: () => undefined };

function moveTo(steps: JobStep[], id: string, label: string): void {
  let at = steps.findIndex((s) => s.id === id);
  if (at < 0) at = steps.push({ id, label, state: 'pending', detail: null }) - 1;
  steps.forEach((s, i) => {
    if (i < at) s.state = 'done';
    else if (i > at) Object.assign(s, { state: 'pending', detail: null });
  });
  const step = steps[at]!;
  // Still on the same step (the model pool switched models): keep what it waits on.
  Object.assign(step, { label, detail: step.state === 'current' ? step.detail : null, state: 'current' });
}

function settle(job: Job, outcome: Outcome, at: number): void {
  for (const s of job.steps) if (s.state === 'current') s.state = outcome.ok ? 'done' : 'failed';
  job.outcome = outcome;
  job.finishedAt = at;
}

function tracker(job: Job, now: () => number): JobTracker {
  const current = () => job.steps.find((s) => s.state === 'current');
  const finish: JobTracker['finish'] = (outcome) => {
    if (job.finishedAt !== null) return;
    const settled: Outcome = outcome.ok ? { ok: true } : ({ ...outcome, resumesAt: outcome.resumesAt ?? null } satisfies FailedOutcome);
    settle(job, settled, now());
  };
  return {
    step(id, label) {
      if (job.finishedAt === null) moveTo(job.steps, id, label);
    },
    note(detail) {
      const step = current();
      if (step) step.detail = detail;
    },
    finish,
    close: () => finish({ ok: false, reason: 'stopped unexpectedly (see the server log)' }),
  };
}

function viewOf(job: Job, at: number): JobProgress {
  const end = job.finishedAt ?? at;
  const elapsedMs = Math.max(0, end - job.startedAt);
  const steps = job.steps.map((s) => ({ ...s }));
  return { id: job.id, startedAt: job.startedAt, elapsedMs, slow: job.finishedAt === null && elapsedMs > JOB_SLOW_MS, steps, outcome: job.outcome };
}

/** In-memory jobs (lost on restart, like digest progress): the server records real steps, clients poll by id. */
export function createJobRegistry(now: () => number = Date.now): JobRegistry {
  const jobs = new Map<string, Job>();

  function prune(): void {
    for (const [id, job] of jobs) if (job.finishedAt !== null && now() - job.finishedAt > FINISHED_KEEP_MS) jobs.delete(id);
    while (jobs.size > MAX_JOBS) jobs.delete(jobs.keys().next().value!);
  }

  return {
    start(id) {
      const job: Job = { id, startedAt: now(), finishedAt: null, steps: [], outcome: null };
      jobs.delete(id);
      jobs.set(id, job);
      prune();
      return tracker(job, now);
    },
    view(id) {
      prune();
      const job = jobs.get(id);
      return job ? viewOf(job, now()) : null;
    },
  };
}
