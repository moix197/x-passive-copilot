import type { StoredPost } from '@xc/shared/types';
import { element } from './dom';
import { renderPostCard } from './post-card';

const POLL_MS = 3000;

export interface PostsViewOptions {
  load: () => Promise<StoredPost[]>;
  render?: (post: StoredPost) => HTMLElement;
  emptyText?: string;
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

export function renderPost(post: StoredPost): HTMLElement {
  const row = document.createElement('article');
  row.className = 'post';
  row.dataset.testid = 'post-row';
  row.dataset.statusId = post.statusId;
  row.append(renderPostCard(post));
  const tags = tagsFor(post);
  if (tags.length) row.append(element('div', tags.join(' · '), 'post-tags'));
  const note = triageNote(post);
  if (note) row.append(element('div', note, 'post-tags'));
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

// Rows reused across polls (an open editor) must never be detached: that would blur the textarea.
function replaceRows(list: HTMLElement, rows: HTMLElement[]): void {
  const keep = new Set<Node>(rows);
  for (const child of [...list.children]) if (!keep.has(child)) child.remove();
  rows.forEach((row, i) => {
    const at = list.children[i] ?? null;
    if (at !== row) list.insertBefore(row, at);
  });
}

export function mountPostsView(root: HTMLElement, options: PostsViewOptions): () => void {
  const status = element('p', 'Loading...', 'status');
  const list = document.createElement('div');
  root.replaceChildren(status, list);
  return pollWhileVisible(async () => {
    try {
      const posts = await options.load();
      replaceRows(list, posts.map(options.render ?? renderPost));
      status.textContent = posts.length ? '' : (options.emptyText ?? 'No posts captured yet.');
    } catch {
      status.textContent = 'Server offline.';
    }
  });
}
