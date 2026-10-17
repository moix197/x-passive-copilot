import type { StoredPost } from '@xc/shared/types';
import { element, mountPostsView, openOnXLink, type PostsViewOptions } from './posts-view';

const COPIED_MS = 1500;

function flagTags(post: StoredPost): string {
  const t = post.triage;
  const tags = [t?.mustFlag ?? '', post.isReply ? 'reply' : '', post.quotedStatusId ? 'quote' : ''];
  return tags.filter(Boolean).join(' · ');
}

function copyButton(draft: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Copy';
  button.addEventListener('click', () => {
    void navigator.clipboard.writeText(draft).then(() => {
      button.textContent = 'Copied';
      setTimeout(() => (button.textContent = 'Copy'), COPIED_MS);
    });
  });
  return button;
}

function triageBody(post: StoredPost): HTMLElement[] {
  const t = post.triage;
  if (!t) return [];
  const parts: HTMLElement[] = [];
  if (t.error) parts.push(element('div', 'triage error', 'post-tags'));
  if (t.reason) parts.push(element('p', t.reason, 'flag-reason'));
  if (t.roughDraft) parts.push(element('p', t.roughDraft, 'flag-draft'), copyButton(t.roughDraft));
  return parts;
}

export function renderFlagged(post: StoredPost): HTMLElement {
  const row = document.createElement('article');
  row.className = 'post';
  row.dataset.testid = 'flagged-row';
  row.dataset.statusId = post.statusId;
  const score = post.triage?.score;
  const badge = element('span', score === null || score === undefined ? '—' : String(Math.round(score)), 'score-badge');
  const head = element('span', ` ${post.authorName} @${post.authorHandle}`, 'post-head');
  const header = document.createElement('div');
  header.append(badge, head);
  row.append(header, element('p', post.text, 'post-text'));
  const tags = flagTags(post);
  if (tags) row.append(element('div', tags, 'post-tags'));
  row.append(...triageBody(post), openOnXLink(post));
  return row;
}

export function mountFlaggedView(
  root: HTMLElement,
  options: Pick<PostsViewOptions, 'load'>,
): () => void {
  return mountPostsView(root, { ...options, render: renderFlagged, emptyText: 'Nothing flagged yet.' });
}
