import { PostListResponseSchema, type FlaggedFeed, type StoredPost } from '@xc/shared/types';
import { errorText, fetchJob, fetchJobs, getJson, markCopied, postJson, requestPolish, sendFeedback } from '../server-api';
import { authHeaders, getServerConfig } from '../server-config';
import { mountActivityTab } from './activity-tab';
import { copyText, type EditableDraftCallbacks, type Rating } from './draft-actions';
import { generateErrorText } from './digest-notice';
import { mountDigestSection } from './digest-section';
import { mountDoctorCard } from './doctor-card';
import { retryJob } from './job-retry';
import { mountFlaggedFeeds, type FlaggedPage } from './flagged-feeds';
import { postUrl } from './post-card';
import { mountPostsView, pollWhileVisible } from './posts-view';
import { mountPowerToggle } from './power-toggle';
import { mountVoiceTab } from './voice-tab';
import { focusOrOpenPostTab } from './x-tab';

type View = 'all' | 'flagged' | 'digest' | 'voice' | 'activity';

const title = document.getElementById('title');
if (title) title.textContent = 'X passive copilot';

async function fetchPosts(query: string, limit = 100) {
  const config = await getServerConfig();
  const res = await fetch(`${config.baseUrl}/v1/posts?limit=${limit}${query}`, { headers: authHeaders(config) });
  if (!res.ok) throw new Error(`server ${res.status}`);
  return PostListResponseSchema.parse(await res.json());
}

const loadAllPosts = async (): Promise<StoredPost[]> => (await fetchPosts('')).posts;

async function loadFlagged(feed: FlaggedFeed, limit: number): Promise<FlaggedPage> {
  const { posts, counts } = await fetchPosts(`&view=flagged&feed=${feed}`, limit);
  return { posts, counts: counts ?? { toReply: posts.length, replied: 0 } };
}

async function loadDoctorReport(): Promise<unknown> {
  const config = await getServerConfig();
  const res = await fetch(`${config.baseUrl}/v1/doctor`, { headers: authHeaders(config) });
  if (!res.ok) throw new Error(`server ${res.status}`);
  return res.json();
}

async function saveStyleNotes(notes: string): Promise<unknown> {
  const res = await postJson('/v1/style-notes', { notes });
  if (!res.ok) throw new Error(`server ${res.status}`);
  return res.json();
}

async function requestRetriage(statusId: string): Promise<string | null> {
  const res = await postJson(`/v1/posts/${encodeURIComponent(statusId)}/retriage`);
  return res.ok ? null : errorText(res);
}

async function setReplied(statusId: string, replied: boolean): Promise<void> {
  const res = await postJson(`/v1/posts/${encodeURIComponent(statusId)}/replied`, { replied });
  if (!res.ok) throw new Error(`server ${res.status}`);
}

async function selectVersion(statusId: string, versionId: number): Promise<void> {
  const res = await postJson(`/v1/drafts/${encodeURIComponent(statusId)}/select`, { versionId });
  if (!res.ok) throw new Error(`server ${res.status}`);
}

// Longer than the server's worst case (3 attempts x 120s opencode timeout + backoff). If it still
// elapses, the button follows the server's `running` flag and the banner shows the outcome.
const DIGEST_RUN_TIMEOUT_MS = 8 * 60_000;
const STILL_RUNNING = 'Still generating on the server; the result shows here when it finishes.';

const numberOrUndefined = (value: unknown) => (typeof value === 'number' ? value : undefined);

async function requestDigestRun(): Promise<Response | null> {
  try {
    return await postJson('/v1/digest/run', undefined, AbortSignal.timeout(DIGEST_RUN_TIMEOUT_MS));
  } catch (e) {
    if ((e as Error).name === 'TimeoutError') return null;
    throw e;
  }
}

async function generateDigest(): Promise<string | null> {
  const res = await requestDigestRun();
  if (!res) return STILL_RUNNING;
  if (res.ok) return null;
  const body = (await res.json().catch(() => ({}))) as { error?: unknown; retryAfterSec?: unknown; resumesAt?: unknown };
  const reason = typeof body.error === 'string' ? body.error : `server ${res.status}`;
  return generateErrorText(reason, numberOrUndefined(body.retryAfterSec), numberOrUndefined(body.resumesAt));
}

async function requestIdeaPolish(ideaId: string): Promise<void> {
  const res = await postJson(`/v1/ideas/${encodeURIComponent(ideaId)}/polish`);
  if (!res.ok) throw new Error(`server ${res.status}`);
}

// Copying means the user is about to reply on X: bring the post up there, but leave it in To reply.
async function onCopied(post: StoredPost): Promise<void> {
  await Promise.all([markCopied(post.statusId), focusOrOpenPostTab(post.statusId, postUrl(post))]);
}

// Remembers this session's thumbs so a poll that was fetched before the save landed cannot revert them.
const sessionRatings = new Map<string, Rating>();

function draftCallbacks(draftId: string, saved: Rating | null = null): EditableDraftCallbacks {
  return {
    rating: sessionRatings.get(draftId) ?? saved,
    onCopy: async (text) => {
      await copyText(text);
      await sendFeedback(draftId, 'copy');
    },
    onEdit: (text) => sendFeedback(draftId, 'edit', text),
    onRate: async (rating: Rating) => {
      const error = await sendFeedback(draftId, rating);
      if (!error) sessionRatings.set(draftId, rating);
      return error;
    },
  };
}

const app = document.getElementById('app');
const tabs = document.querySelectorAll<HTMLButtonElement>('[role="tab"][data-view]');
let dispose: (() => void) | null = null;

function selectView(view: View): void {
  if (!app) return;
  dispose?.();
  for (const tab of tabs) tab.setAttribute('aria-selected', String(tab.dataset.view === view));
  dispose = mountView(app, view);
}

const activityBadge = document.querySelector<HTMLElement>('[data-testid="activity-badge"]');

// The Activity tab shows how many jobs run right now.
async function loadJobs() {
  const jobs = await fetchJobs();
  const running = jobs.filter((job) => !job.outcome).length;
  if (activityBadge) {
    activityBadge.textContent = String(running);
    activityBadge.hidden = running === 0;
  }
  return jobs;
}

function mountView(root: HTMLElement, view: View): () => void {
  if (view === 'activity') {
    return mountActivityTab(root, {
      load: loadJobs,
      fetchJob,
      onRetry: retryJob,
      onCopy: copyText,
      onOpenPost: focusOrOpenPostTab,
    });
  }
  if (view === 'voice') return mountVoiceTab(root, () => getJson('/v1/voice'), { load: () => getJson('/v1/style-notes'), save: saveStyleNotes });
  if (view === 'digest') {
    return mountDigestSection(root, {
      load: () => getJson('/v1/digest'),
      onGenerate: generateDigest,
      onPolishIdea: requestIdeaPolish,
      draftCallbacks: (ideaId) => draftCallbacks(`idea-${ideaId}`),
    });
  }
  if (view === 'flagged') {
    return mountFlaggedFeeds(root, {
      load: loadFlagged,
      onSetReplied: setReplied,
      onCopied,
      onPolish: (statusId) => requestPolish(statusId),
      onRetriage: requestRetriage,
      onRegenerate: (statusId) => requestPolish(statusId, true),
      onSelectVersion: selectVersion,
      draftCallbacks,
      fetchJob,
    });
  }
  return mountPostsView(root, { load: loadAllPosts });
}

for (const tab of tabs) tab.addEventListener('click', () => selectView(tab.dataset.view as View));
selectView('all');
pollWhileVisible(() => loadJobs().then(() => undefined));

const powerToggle = document.getElementById('power-toggle');
const powerLabel = document.getElementById('power-label');
const doctorRoot = document.getElementById('doctor');
if (powerToggle instanceof HTMLInputElement && powerLabel && doctorRoot) {
  const doctor = mountDoctorCard(doctorRoot, loadDoctorReport);
  mountPowerToggle(powerToggle, powerLabel, (status) => doctor.refresh(status.state === 'online'));
}
