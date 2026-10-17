import { PostListResponseSchema, type StoredPost } from '@xc/shared/types';
import { authHeaders, getServerConfig } from '../server-config';
import { mountPostsView } from './posts-view';

const title = document.getElementById('title');
if (title) title.textContent = 'X passive copilot';

async function loadPosts(): Promise<StoredPost[]> {
  const config = await getServerConfig();
  const res = await fetch(`${config.baseUrl}/v1/posts?limit=100`, { headers: authHeaders(config) });
  if (!res.ok) throw new Error(`server ${res.status}`);
  return PostListResponseSchema.parse(await res.json()).posts;
}

const app = document.getElementById('app');
if (app) mountPostsView(app, { load: loadPosts });
