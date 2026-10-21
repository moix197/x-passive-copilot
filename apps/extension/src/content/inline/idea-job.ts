import { SERVER_OFFLINE, type ComposeIdeasReply, type DigestIdea, type JobEntry } from '@xc/shared/types';
import { watchJobProgress, type JobProgressHandle } from '../../panel/job-progress';
import { fetchJobProgress, latestJobFor } from './relay';

/** The generation part of a card's state (the compose card, Post idea). */
export interface IdeaJobState {
  generating: boolean;
  /** Why the last request gave nothing: a refusal, or the quota pause's resume time. */
  note: string;
  noteTitle: string;
  /** The running (or ended) generation's step list, and the id it follows. */
  job: JobProgressHandle | null;
  jobId: string | null;
}

export interface IdeaJobHooks {
  render: () => void;
  retry: () => void;
  cancel: () => void;
  /** A generation made this idea. */
  onIdea: (idea: DigestIdea) => void;
}

/** Once the reply is in, the step list ends with it: Done, or the reason (and Retry). */
function settleIdeaJob(job: JobProgressHandle | null, reply: ComposeIdeasReply): JobProgressHandle | null {
  job?.settle(reply.error ? { ok: false, reason: reply.error, resumesAt: reply.resumesAt } : { ok: true });
  return job;
}

/**
 * Follows one generation's live steps: one this card just asked for, or one already running for its target (after a
 * reload, or a second click). When polling sees it end first, its idea shows and the card stops generating.
 */
export function followIdeaJob(state: IdeaJobState, jobId: string, hooks: IdeaJobHooks, initial?: JobEntry): void {
  state.job?.stop();
  const onFinish = (view: JobEntry) => {
    if (state.jobId !== view.id) return;
    if (view.result?.type === 'idea') hooks.onIdea(view.result.idea);
    Object.assign(state, { generating: false, jobId: null });
    hooks.render();
  };
  const job = watchJobProgress({
    jobId,
    title: 'Generating idea',
    fetchJob: fetchJobProgress,
    unknown: 'queued',
    onRetry: hooks.retry,
    onCancel: hooks.cancel,
    onFinish,
    initial,
  });
  Object.assign(state, { generating: !initial?.outcome, note: '', noteTitle: '', jobId, job });
  hooks.render();
}

// The request broke (the server went down) after the server took the job: the job's own steps tell how it ends.
const lostReply = (state: IdeaJobState, reply: ComposeIdeasReply) => reply.error === SERVER_OFFLINE && Boolean(state.job?.known());

/** A generate request's reply: its idea, then the step list ends with it, or follows the running job it was handed. */
export function finishIdeaRequest(state: IdeaJobState, jobId: string, reply: ComposeIdeasReply, hooks: IdeaJobHooks): void {
  reply.ideas.forEach(hooks.onIdea);
  if (state.jobId === jobId) {
    if (reply.job) return followIdeaJob(state, reply.job.id, hooks, reply.job);
    if (!lostReply(state, reply)) Object.assign(state, { generating: false, jobId: null, job: settleIdeaJob(state.job, reply) });
  }
  hooks.render();
}

/** The newest job for this key when it is still running; null otherwise. */
export async function runningJobFor(key: string): Promise<JobEntry | null> {
  const job = await latestJobFor(key);
  return job && !job.outcome ? job : null;
}
