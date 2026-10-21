import type { JobEntry, JobKind } from '@xc/shared/types';
import { element } from './dom';
import { copyButton } from './draft-actions';
import { watchJobProgress, type FetchJob, type JobProgressHandle } from './job-progress';
import { postUrl } from './post-card';
import { pollWhileVisible } from './posts-view';

export interface ActivityHandlers {
  /** Running and recent jobs, newest first. */
  load: () => Promise<JobEntry[]>;
  fetchJob: FetchJob;
  /** Starts the failed job's work again. */
  onRetry: (job: JobEntry) => Promise<void>;
  onCopy: (text: string) => Promise<void>;
  onOpenPost: (statusId: string, url: string) => Promise<void>;
}

const POLL_MS = 1000;
const EXCERPT_CHARS = 60;

const KIND_LABELS: Record<JobKind, string> = {
  'post-idea': 'Post idea',
  'quote-idea': 'Quote idea',
  'compose-idea': 'Compose idea',
  polish: 'Polish',
  regenerate: 'Regenerate',
  digest: 'Digest',
};

const RUNNING_TITLES: Record<JobKind, string> = {
  'post-idea': 'Generating idea',
  'quote-idea': 'Generating idea',
  'compose-idea': 'Generating idea',
  polish: 'Polishing reply',
  regenerate: 'Regenerating reply',
  digest: 'Generating digest',
};

const excerpt = (text: string) => text.replace(/\s+/g, ' ').slice(0, EXCERPT_CHARS);

/** "Post idea · @author: excerpt", "Polish · @author", "Digest", ... */
export function jobLabel(job: Pick<JobEntry, 'kind' | 'target'>): string {
  const kind = KIND_LABELS[job.kind];
  const { target } = job;
  if (target.type === 'idea') return `${kind} · idea`;
  if (target.type !== 'post') return kind;
  return job.kind === 'post-idea' ? `${kind} · @${target.authorHandle}: ${excerpt(target.text)}` : `${kind} · @${target.authorHandle}`;
}

const resultText = (job: JobEntry): string | null =>
  job.result ? (job.result.type === 'idea' ? job.result.idea.text : job.result.text) : null;

function resultBlock(job: JobEntry, onCopy: ActivityHandlers['onCopy']): HTMLElement[] {
  const text = resultText(job);
  if (text === null) return [];
  const line = element('p', text, 'reply-text');
  line.dataset.testid = 'activity-job-result';
  const actions = element('div', '', 'draft-actions');
  actions.append(copyButton(text, onCopy));
  return [line, actions];
}

function openPostButton(job: JobEntry, onOpenPost: ActivityHandlers['onOpenPost']): HTMLElement[] {
  const { target } = job;
  if (target.type !== 'post' || !target.statusId) return [];
  const { statusId, authorHandle } = target;
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Open post';
  button.dataset.testid = 'activity-open-post';
  button.addEventListener('click', () => void onOpenPost(statusId, postUrl({ statusId, authorHandle })));
  const bar = element('div', '', 'draft-actions');
  bar.append(button);
  return [bar];
}

const jobState = (job: JobEntry) => (job.outcome ? (job.outcome.ok ? 'done' : 'failed') : 'running');

function jobCard(job: JobEntry, box: HTMLElement, handlers: ActivityHandlers): HTMLElement {
  const card = element('article', '', 'post activity-job');
  card.dataset.testid = 'activity-job';
  card.dataset.jobId = job.id;
  card.dataset.state = jobState(job);
  const label = element('p', jobLabel(job), 'section-label');
  label.dataset.testid = 'activity-job-label';
  card.append(label, box, ...resultBlock(job, handlers.onCopy), ...openPostButton(job, handlers.onOpenPost));
  return card;
}

// One step-list box per job run (a polish id repeats, so the start time is part of the key), kept across polls.
const runKey = (job: JobEntry) => `${job.id}@${job.startedAt}`;

function boxKeeper(handlers: ActivityHandlers) {
  const boxes = new Map<string, JobProgressHandle>();
  const boxFor = (job: JobEntry): HTMLElement => {
    const key = runKey(job);
    let handle = boxes.get(key);
    if (!handle) {
      const onRetry = () => void handlers.onRetry(job);
      handle = watchJobProgress({ jobId: job.id, title: RUNNING_TITLES[job.kind], fetchJob: handlers.fetchJob, unknown: 'queued', initial: job, onRetry });
      boxes.set(key, handle);
    }
    return handle.box;
  };
  const keepOnly = (jobs: JobEntry[]) => {
    const listed = new Set(jobs.map(runKey));
    for (const [key, handle] of boxes) {
      if (listed.has(key)) continue;
      handle.stop();
      boxes.delete(key);
    }
  };
  const stopAll = () => keepOnly([]);
  return { boxFor, keepOnly, stopAll };
}

function section(title: string, testId: string, cards: HTMLElement[]): HTMLElement[] {
  if (cards.length === 0) return [];
  const wrap = element('section', '', 'activity-section');
  wrap.dataset.testid = testId;
  wrap.setAttribute('aria-label', title);
  const head = element('h2', title, 'status');
  wrap.append(head, ...cards);
  return [wrap];
}

/** The Activity tab: running jobs with live steps on top, then recent finished ones with their result, Copy and Retry. */
export function mountActivityTab(root: HTMLElement, handlers: ActivityHandlers): () => void {
  const status = element('p', 'Loading...', 'status');
  const list = document.createElement('div');
  root.replaceChildren(status, list);
  const keeper = boxKeeper(handlers);
  const render = (jobs: JobEntry[]) => {
    keeper.keepOnly(jobs);
    const cards = (done: boolean) => jobs.filter((j) => Boolean(j.outcome) === done).map((j) => jobCard(j, keeper.boxFor(j), handlers));
    list.replaceChildren(...section('Running', 'activity-running', cards(false)), ...section('Recent', 'activity-recent', cards(true)));
    status.textContent = jobs.length ? '' : 'No generations yet. Ideas, polishes and digests show here while they run.';
  };
  const refresh = async () => {
    try {
      render(await handlers.load());
    } catch {
      status.textContent = 'Server offline.';
    }
  };
  const stopPolling = pollWhileVisible(refresh, () => POLL_MS);
  return () => {
    stopPolling();
    keeper.stopAll();
  };
}
