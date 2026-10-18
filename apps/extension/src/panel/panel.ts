import { PostListResponseSchema, type StoredPost } from '@xc/shared/types';
import { authHeaders, getServerConfig } from '../server-config';
import { copyText, type DraftCallbacks, type Rating } from './draft-actions';
import { mountDigestSection } from './digest-section';
import { mountDoctorCard } from './doctor-card';
import { mountFlaggedView } from './flagged-view';
import { mountPostsView } from './posts-view';
import { mountPowerToggle } from './power-toggle';
import { mountVoiceTab } from './voice-tab';

type View = 'all' | 'flagged' | 'digest' | 'voice';

const title = document.getElementById('title');
if (title) title.textContent = 'X passive copilot';

async function loadPosts(view: View): Promise<StoredPost[]> {
  const config = await getServerConfig();
  const url = `${config.baseUrl}/v1/posts?limit=100${view === 'flagged' ? '&view=flagged' : ''}`;
  const res = await fetch(url, { headers: authHeaders(config) });
  if (!res.ok) throw new Error(`server ${res.status}`);
  return PostListResponseSchema.parse(await res.json()).posts;
}

async function loadDoctorReport(): Promise<unknown> {
  const config = await getServerConfig();
  const res = await fetch(`${config.baseUrl}/v1/doctor`, { headers: authHeaders(config) });
  if (!res.ok) throw new Error(`server ${res.status}`);
  return res.json();
}


async function getJson(path: string): Promise<unknown> {
  const config = await getServerConfig();
  const res = await fetch(`${config.baseUrl}${path}`, { headers: authHeaders(config) });
  if (!res.ok) throw new Error(`server ${res.status}`);
  return res.json();
}

async function postJson(path: string, body?: unknown): Promise<Response> {
  const config = await getServerConfig();
  const headers = { ...authHeaders(config), ...(body === undefined ? {} : { 'content-type': 'application/json' }) };
  return fetch(`${config.baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function saveStyleNotes(notes: string): Promise<unknown> {
  const res = await postJson('/v1/style-notes', { notes });
  if (!res.ok) throw new Error(`server ${res.status}`);
  return res.json();
}

async function requestPolish(statusId: string, regenerate = false): Promise<void> {
  const query = regenerate ? '?regenerate=1' : '';
  const res = await postJson(`/v1/posts/${encodeURIComponent(statusId)}/polish${query}`);
  if (!res.ok) throw new Error(`server ${res.status}`);
}

async function selectVersion(statusId: string, versionId: number): Promise<void> {
  const res = await postJson(`/v1/drafts/${encodeURIComponent(statusId)}/select`, { versionId });
  if (!res.ok) throw new Error(`server ${res.status}`);
}

async function generateDigest(): Promise<string | null> {
  const res = await postJson('/v1/digest/run');
  if (res.ok) return null;
  const body = (await res.json().catch(() => ({}))) as { error?: unknown; retryAfterSec?: unknown };
  const reason = typeof body.error === 'string' ? body.error : `server ${res.status}`;
  return typeof body.retryAfterSec === 'number' ? `${reason} (try again in ${body.retryAfterSec}s)` : reason;
}

async function requestIdeaPolish(ideaId: string): Promise<void> {
  const res = await postJson(`/v1/ideas/${encodeURIComponent(ideaId)}/polish`);
  if (!res.ok) throw new Error(`server ${res.status}`);
}

async function sendFeedback(draftId: string, kind: 'copy' | 'edit' | 'up' | 'down', text?: string): Promise<string | null> {
  const res = await postJson(`/v1/drafts/${encodeURIComponent(draftId)}/feedback`, { kind, text });
  if (res.ok) return null;
  const body = (await res.json().catch(() => ({}))) as { error?: unknown };
  return typeof body.error === 'string' ? body.error : `server ${res.status}`;
}

// Remembers this session's thumbs so a poll that was fetched before the save landed cannot revert them.
const sessionRatings = new Map<string, Rating>();

function draftCallbacks(draftId: string, saved: Rating | null = null): DraftCallbacks {
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
  const load = () => loadPosts(view);
  dispose = mountView(app, view, load);
}

function mountView(root: HTMLElement, view: View, load: () => Promise<StoredPost[]>): () => void {
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
    return mountFlaggedView(root, {
      load,
      onPolish: (statusId) => requestPolish(statusId),
      onRegenerate: (statusId) => requestPolish(statusId, true),
      onSelectVersion: selectVersion,
      draftCallbacks,
    });
  }
  return mountPostsView(root, { load });
}

for (const tab of tabs) tab.addEventListener('click', () => selectView(tab.dataset.view as View));
selectView('all');

const powerToggle = document.getElementById('power-toggle');
const powerLabel = document.getElementById('power-label');
const doctorRoot = document.getElementById('doctor');
if (powerToggle instanceof HTMLInputElement && powerLabel && doctorRoot) {
  const doctor = mountDoctorCard(doctorRoot, loadDoctorReport);
  mountPowerToggle(powerToggle, powerLabel, (status) => doctor.refresh(status.state === 'online'));
}
