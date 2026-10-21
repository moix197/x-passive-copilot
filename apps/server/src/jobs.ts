import { MAX_LISTED_JOBS, type JobEntry, type JobKind, type JobProgress, type JobResult, type JobStep, type JobTarget } from '@xc/shared';

/** Past this a running job shows "taking longer than usual" (a retry after high demand alone waits 10s, then 20s). */
export const JOB_SLOW_MS = 90_000;
/** A finished job stays listed this long (the panel Activity tab), unless newer ones push it out. */
export const FINISHED_KEEP_MS = 24 * 60 * 60_000;

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
  finish(outcome: { ok: true; result?: JobResult } | { ok: false; reason: string; resumesAt?: number | null }): void;
  /** Fails a job that ended without an outcome (it threw), so no client watches it forever. */
  close(): void;
}

/** What a job is for, given when it starts. */
export interface JobMeta {
  kind: JobKind;
  key: string;
  target: JobTarget;
  ideaKind?: JobEntry['ideaKind'];
}

export interface JobRegistry {
  /** A fresh job under this id (an older one with the same id is replaced). */
  start(id: string, meta: JobMeta): JobTracker;
  view(id: string): JobEntry | null;
  /** The running job with this key, if any. */
  running(key: string): JobEntry | null;
  /** Running and recent jobs, newest first. */
  list(): JobEntry[];
}

interface Job {
  id: string;
  meta: JobMeta;
  startedAt: number;
  finishedAt: number | null;
  steps: JobStep[];
  outcome: Outcome | null;
  result: JobResult | null;
}

/** For callers that run without anyone watching (unit tests). */
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
    if (outcome.ok) job.result = outcome.result ?? null;
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

function viewOf(job: Job, at: number): JobEntry {
  const end = job.finishedAt ?? at;
  const elapsedMs = Math.max(0, end - job.startedAt);
  const { kind, key, target, ideaKind = null } = job.meta;
  return {
    id: job.id,
    startedAt: job.startedAt,
    elapsedMs,
    slow: job.finishedAt === null && elapsedMs > JOB_SLOW_MS,
    steps: job.steps.map((s) => ({ ...s })),
    outcome: job.outcome,
    kind,
    key,
    target,
    ideaKind,
    finishedAt: job.finishedAt,
    result: job.result,
  };
}

// Oldest finished jobs go first; a running job is never dropped (its client still polls it).
function dropOldestFinished(jobs: Map<string, Job>): boolean {
  for (const [id, job] of jobs) {
    if (job.finishedAt !== null) return jobs.delete(id);
  }
  return false;
}

/** In-memory jobs (lost on restart, like digest progress): the server records real steps, clients poll by id. */
export function createJobRegistry(now: () => number = Date.now): JobRegistry {
  const jobs = new Map<string, Job>();

  function prune(): void {
    for (const [id, job] of jobs) if (job.finishedAt !== null && now() - job.finishedAt > FINISHED_KEEP_MS) jobs.delete(id);
    while (jobs.size > MAX_LISTED_JOBS && dropOldestFinished(jobs));
  }

  const views = () => [...jobs.values()].reverse().map((job) => viewOf(job, now()));

  return {
    start(id, meta) {
      const job: Job = { id, meta, startedAt: now(), finishedAt: null, steps: [], outcome: null, result: null };
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
    running(key) {
      const job = [...jobs.values()].find((j) => j.finishedAt === null && j.meta.key === key);
      return job ? viewOf(job, now()) : null;
    },
    list() {
      prune();
      return views().slice(0, MAX_LISTED_JOBS);
    },
  };
}
