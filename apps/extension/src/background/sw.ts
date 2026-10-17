import { CaptureMessageSchema, CapturedPostSchema, type CapturedPost } from '@xc/shared/types';
import { authHeaders, getServerConfig } from '../server-config';

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

function keepValidPosts(posts: unknown[]): CapturedPost[] {
  return posts.flatMap((post) => {
    const parsed = CapturedPostSchema.safeParse(post);
    return parsed.success ? [parsed.data] : [];
  });
}

async function relayPosts(posts: CapturedPost[]): Promise<{ ok: boolean }> {
  if (posts.length === 0) return { ok: true };
  try {
    const config = await getServerConfig();
    const res = await fetch(`${config.baseUrl}/v1/posts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(config) },
      body: JSON.stringify({ posts }),
    });
    return { ok: res.ok };
  } catch {
    return { ok: false };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  const parsed = CaptureMessageSchema.safeParse(message);
  if (!parsed.success) return false;
  void relayPosts(keepValidPosts(parsed.data.posts)).then(sendResponse);
  return true;
});
