import type { StoredPost } from '@xc/shared/types';

const POLL_MS = 3000;

export interface PostsViewOptions {
  load: () => Promise<StoredPost[]>;
  render?: (post: StoredPost) => HTMLElement;
  emptyText?: string;
}

export function element(tag: string, text: string, className?: string): HTMLElement {
  const el = document.createElement(tag);
  el.textContent = text;
  if (className) el.className = className;
  return el;
}

function formatTime(iso: string | null): string {
  const date = iso ? new Date(iso) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : '';
}

function metricsLine(m: StoredPost['metrics']): string {
  return `${m.replies} replies · ${m.reposts} reposts · ${m.likes} likes · ${m.views} views`;
}

function tagsFor(post: StoredPost): string[] {
  return [...(post.isReply ? ['reply'] : []), ...(post.quotedStatusId ? ['quote'] : [])];
}

function triageNote(post: StoredPost): string {
  const t = post.triage;
  if (!t) return '';
  if (t.skipReason) return `skipped: ${t.skipReason}`;
  return t.error ? 'triage error' : '';
}

export function openOnXLink(post: StoredPost): HTMLAnchorElement {
  const link = document.createElement('a');
  link.textContent = 'Open on X';
  link.href = `https://x.com/${encodeURIComponent(post.authorHandle)}/status/${post.statusId}`;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

export function renderPost(post: StoredPost): HTMLElement {
  const row = document.createElement('article');
  row.className = 'post';
  row.dataset.testid = 'post-row';
  row.dataset.statusId = post.statusId;
  const head = element('div', `${post.authorName} @${post.authorHandle} ${formatTime(post.postedAt)}`, 'post-head');
  row.append(head, element('p', post.text, 'post-text'), element('div', metricsLine(post.metrics), 'post-metrics'));
  const tags = tagsFor(post);
  if (tags.length) row.append(element('div', tags.join(' · '), 'post-tags'));
  const note = triageNote(post);
  if (note) row.append(element('div', note, 'post-tags'));
  row.append(openOnXLink(post));
  return row;
}

/** Runs `task` now, every POLL_MS and on becoming visible; never overlaps, skips while hidden. */
export function pollWhileVisible(task: () => Promise<void>): () => void {
  let busy = false;
  const refresh = async () => {
    if (busy || document.visibilityState !== 'visible') return;
    busy = true;
    try {
      await task();
    } finally {
      busy = false;
    }
  };
  const onVisibility = () => void refresh();
  document.addEventListener('visibilitychange', onVisibility);
  const timer = setInterval(() => void refresh(), POLL_MS);
  void refresh();
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

export function mountPostsView(root: HTMLElement, options: PostsViewOptions): () => void {
  const status = element('p', 'Loading...', 'status');
  const list = document.createElement('div');
  root.replaceChildren(status, list);
  return pollWhileVisible(async () => {
    try {
      const posts = await options.load();
      list.replaceChildren(...posts.map(options.render ?? renderPost));
      status.textContent = posts.length ? '' : (options.emptyText ?? 'No posts captured yet.');
    } catch {
      status.textContent = 'Server offline.';
    }
  });
}
