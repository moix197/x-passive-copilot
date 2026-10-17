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

async function requestPolish(statusId: string): Promise<void> {
  const config = await getServerConfig();
  const res = await fetch(`${config.baseUrl}/v1/posts/${encodeURIComponent(statusId)}/polish`, {
    method: 'POST',
    headers: authHeaders(config),
  });
  if (!res.ok) throw new Error(`server ${res.status}`);
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

function draftCallbacks(draftId: string): DraftCallbacks {
  return {
    onCopy: async (text) => {
      await copyText(text);
      await sendFeedback(draftId, 'copy');
    },
    onEdit: (text) => sendFeedback(draftId, 'edit', text),
    onRate: async (rating: Rating) => void (await sendFeedback(draftId, rating)),
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
  if (view === 'voice') return mountVoiceTab(root, () => getJson('/v1/voice'));
  if (view === 'digest') {
    return mountDigestSection(root, {
      load: () => getJson('/v1/digest'),
      onPolishIdea: requestIdeaPolish,
      draftCallbacks: (ideaId) => draftCallbacks(`idea-${ideaId}`),
    });
  }
  if (view === 'flagged') return mountFlaggedView(root, { load, onPolish: requestPolish, draftCallbacks });
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
