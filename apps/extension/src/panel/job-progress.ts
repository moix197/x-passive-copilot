import { polishJobId, type JobProgress, type JobStep } from '@xc/shared/types';
import { elapsedText, renderStep } from './digest-progress';
import { element } from './dom';
import { formatAbsoluteTime } from './post-format';

/** Fetches a job's progress; null when the server does not know it (not started yet, or restarted). */
export type FetchJob = (jobId: string) => Promise<JobProgress | null>;

export interface JobProgressOptions {
  jobId: string;
  /** What runs, e.g. "Generating idea"; the title until the job ends. */
  title: string;
  fetchJob: FetchJob;
  /** An unknown job: show "Queued" (its request may not have arrived yet) or hide the box. */
  unknown: 'queued' | 'hidden';
  /** Shown as Retry once the job failed. */
  onRetry?: () => void;
  /** Shown as Cancel while the job runs longer than usual. */
  onCancel?: () => void;
}

export interface JobProgressHandle {
  box: HTMLElement;
  /**
   * Ends the watch with the request's own outcome (its reply came back), keeping the steps seen so far:
   * Done with every step ticked, or the reason the reply gave.
   */
  settle(outcome: Outcome): void;
  /** Stops following the job (done, or the user cancelled). */
  stop(): void;
}

const POLL_MS = 1000;
/** Stop asking after this long, whatever the server says; a job that long is lost. */
const MAX_WATCH_MS = 15 * 60_000;
const MAX_WATCHES = 50;

type Paint = (view: JobProgress | null) => void;
type Outcome = NonNullable<JobProgress['outcome']>;

/** One poll loop per job, however many boxes show it (the panel rebuilds its cards on every refresh). */
interface Watch {
  view: JobProgress | null;
  paints: Set<Paint>;
  startedAt: number;
  polling: boolean;
  /** Polls in a row that found no job before any view arrived. */
  misses: number;
}

const watches = new Map<string, Watch>();

/** Polls without a job before giving up on it (its request reached no server, or the server restarted). */
const MAX_MISSES = 5;

const isOver = (watch: Watch) =>
  watch.view?.outcome != null || watch.misses >= MAX_MISSES || Date.now() - watch.startedAt > MAX_WATCH_MS;

async function refresh(jobId: string, watch: Watch, fetchJob: FetchJob): Promise<void> {
  const view = await fetchJob(jobId).catch(() => null);
  watch.misses = view || watch.view ? 0 : watch.misses + 1;
  watch.view = view ?? watch.view;
  for (const paint of watch.paints) paint(watch.view);
}

// Asks at once, then every second until the job ends or no box follows it.
async function poll(jobId: string, watch: Watch, fetchJob: FetchJob): Promise<void> {
  watch.polling = true;
  await refresh(jobId, watch, fetchJob);
  while (!isOver(watch) && watch.paints.size > 0) {
    await new Promise((done) => setTimeout(done, POLL_MS));
    await refresh(jobId, watch, fetchJob);
  }
  watch.paints.clear();
  watch.polling = false;
}

// A box expecting a running job never reuses a finished watch: a polish job id comes back on the next Regenerate.
function watchFor(jobId: string, expectRunning: boolean): Watch {
  const kept = watches.get(jobId);
  if (kept && !(expectRunning && isOver(kept))) return kept;
  watches.delete(jobId);
  const watch: Watch = { view: null, paints: new Set(), startedAt: Date.now(), polling: false, misses: 0 };
  watches.set(jobId, watch);
  if (watches.size > MAX_WATCHES) watches.delete(watches.keys().next().value ?? jobId);
  return watch;
}

function follow({ jobId, fetchJob, unknown }: JobProgressOptions, paint: Paint): () => void {
  const watch = watchFor(jobId, unknown === 'queued');
  paint(watch.view);
  if (isOver(watch)) return () => undefined;
  watch.paints.add(paint);
  if (!watch.polling) void poll(jobId, watch, fetchJob);
  return () => watch.paints.delete(paint);
}

const QUEUED: JobStep = { id: 'queued', label: 'Queued', state: 'current', detail: null };

function placeholder(jobId: string, startedAt: number): JobProgress {
  return { id: jobId, startedAt, elapsedMs: Date.now() - startedAt, slow: false, steps: [QUEUED], outcome: null };
}

/** The reply's outcome on the last steps seen: the current step ends done or failed, elapsed stops. */
function settledView(view: JobProgress, outcome: Outcome): JobProgress {
  const state = outcome.ok ? ('done' as const) : ('failed' as const);
  const steps = view.steps.map((s) => (s.state === 'current' || (outcome.ok && s.state === 'pending') ? { ...s, state } : s));
  const elapsedMs = view.outcome ? view.elapsedMs : Date.now() - view.startedAt;
  return { ...view, slow: false, elapsedMs, steps, outcome };
}

function titleText(view: JobProgress, title: string): string {
  const outcome = view.outcome;
  if (!outcome) return view.slow ? `${title}: taking longer than usual` : title;
  if (outcome.ok) return 'Done';
  if (outcome.resumesAt) return `Quota paused until ${formatAbsoluteTime(new Date(outcome.resumesAt).toISOString())}`;
  return `Failed: ${outcome.reason}`;
}

function actionButton(label: string, testId: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.dataset.testid = testId;
  button.addEventListener('click', onClick);
  return button;
}

function actionBar(view: JobProgress, options: JobProgressOptions): HTMLElement[] {
  const failed = view.outcome?.ok === false;
  const button = failed && options.onRetry
    ? actionButton('Retry', 'job-retry', options.onRetry)
    : !view.outcome && view.slow && options.onCancel
      ? actionButton('Cancel', 'job-cancel', options.onCancel)
      : null;
  if (!button) return [];
  const bar = element('div', '', 'draft-actions');
  bar.append(button);
  return [bar];
}

function renderHead(view: JobProgress, title: string): HTMLElement {
  const head = element('div', '', 'digest-progress-head');
  const titleLine = element('span', titleText(view, title), 'digest-progress-title');
  titleLine.dataset.testid = 'job-progress-title';
  const elapsed = element('span', elapsedText(view.elapsedMs), 'digest-progress-elapsed');
  elapsed.dataset.testid = 'job-progress-elapsed';
  head.append(titleLine, elapsed);
  return head;
}

function paintBox(box: HTMLElement, view: JobProgress, options: JobProgressOptions): void {
  const outcome = view.outcome;
  box.hidden = false;
  box.className = `digest-progress job-progress${outcome ? (outcome.ok ? ' ok' : ' failed') : ''}`;
  const steps = document.createElement('ol');
  steps.className = 'digest-steps';
  steps.append(...view.steps.map((step) => renderStep(step, 'job-step')));
  box.replaceChildren(renderHead(view, options.title), steps, ...actionBar(view, options));
}

function newBox(): HTMLElement {
  const box = document.createElement('section');
  box.className = 'digest-progress job-progress';
  box.dataset.testid = 'job-progress';
  box.setAttribute('aria-label', 'Progress');
  box.setAttribute('aria-live', 'polite');
  return box;
}

/** A live step list with an elapsed timer for one idea or polish job, polled from the server every second. */
export function watchJobProgress(options: JobProgressOptions): JobProgressHandle {
  const box = newBox();
  const startedAt = Date.now();
  let last: JobProgress | null = null;
  let settled = false;
  const paint: Paint = (view) => {
    if (settled) return;
    last = view ?? last;
    if (!last && options.unknown === 'hidden') return void (box.hidden = true);
    paintBox(box, last ?? placeholder(options.jobId, startedAt), options);
  };
  const unfollow = follow(options, paint);
  const stop = () => {
    settled = true;
    unfollow();
  };
  // The server finished the job before replying: its final steps replace the last ones polled, when it has them.
  const settle = (outcome: Outcome) => {
    stop();
    paintBox(box, settledView(last ?? placeholder(options.jobId, startedAt), outcome), options);
    void options.fetchJob(options.jobId).then((view) => {
      if (view?.outcome) paintBox(box, view, options);
    }, () => undefined);
  };
  return { box, settle, stop };
}

export interface PolishProgressOptions {
  regenerating: boolean;
  fetchJob: FetchJob;
  /** While it runs, an unknown job still shows as queued; a failed draft shows its job only while the server has it. */
  unknown: JobProgressOptions['unknown'];
  onRetry?: () => void;
}

/** The live steps of a post's polish or regenerate (Claude, guard, regenerate after a guard flag, save). */
export function polishProgressBox(statusId: string, options: PolishProgressOptions): HTMLElement {
  const title = options.regenerating ? 'Regenerating reply' : 'Polishing reply';
  return watchJobProgress({ jobId: polishJobId(statusId), title, ...options }).box;
}
