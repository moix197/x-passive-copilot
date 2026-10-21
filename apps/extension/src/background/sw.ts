import {
  CaptureMessageSchema,
  CapturedPostSchema,
  LinkControlMessageSchema,
  type CapturedPost,
} from '@xc/shared/types';
import { authHeaders, getServerConfig } from '../server-config';
import { answerInlineMessage } from './inline-relay';
import { restoreNativeLink, setDesiredOnline } from './native-link';

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
    if (!config.token) return { ok: true }; // offline: captures are dropped on purpose
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
  const control = LinkControlMessageSchema.safeParse(message);
  if (control.success) {
    if (sender.tab) return false; // only extension pages (the panel) may toggle the link
    void setDesiredOnline(control.data.online).then(() => sendResponse({ ok: true }));
    return true;
  }
  const inline = answerInlineMessage(message);
  if (inline) {
    void inline.then(sendResponse);
    return true;
  }
  const parsed = CaptureMessageSchema.safeParse(message);
  if (!parsed.success) return false;
  void relayPosts(keepValidPosts(parsed.data.posts)).then(sendResponse);
  return true;
});

void restoreNativeLink();
