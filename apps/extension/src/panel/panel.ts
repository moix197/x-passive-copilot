import { PostListResponseSchema, type StoredPost } from '@xc/shared/types';
import { authHeaders, getServerConfig } from '../server-config';
import { mountFlaggedView } from './flagged-view';
import { mountPostsView } from './posts-view';

type View = 'all' | 'flagged';

const title = document.getElementById('title');
if (title) title.textContent = 'X passive copilot';

async function loadPosts(view: View): Promise<StoredPost[]> {
  const config = await getServerConfig();
  const url = `${config.baseUrl}/v1/posts?limit=100${view === 'flagged' ? '&view=flagged' : ''}`;
  const res = await fetch(url, { headers: authHeaders(config) });
  if (!res.ok) throw new Error(`server ${res.status}`);
  return PostListResponseSchema.parse(await res.json()).posts;
}

async function requestPolish(statusId: string): Promise<void> {
  const config = await getServerConfig();
  const res = await fetch(`${config.baseUrl}/v1/posts/${encodeURIComponent(statusId)}/polish`, {
    method: 'POST',
    headers: authHeaders(config),
  });
  if (!res.ok) throw new Error(`server ${res.status}`);
}

const app = document.getElementById('app');
const tabs = document.querySelectorAll<HTMLButtonElement>('[role="tab"][data-view]');
let dispose: (() => void) | null = null;

function selectView(view: View): void {
  if (!app) return;
  dispose?.();
  for (const tab of tabs) tab.setAttribute('aria-selected', String(tab.dataset.view === view));
  const load = () => loadPosts(view);
  dispose = view === 'flagged' ? mountFlaggedView(app, { load, onPolish: requestPolish }) : mountPostsView(app, { load });
}

for (const tab of tabs) tab.addEventListener('click', () => selectView(tab.dataset.view as View));
selectView('all');
