import type { StoredPost } from '@xc/shared/types';
import { element } from './dom';
import { formatAbsoluteTime, formatRelativeTime, initialsFor } from './post-format';

function postUrl(post: StoredPost): string {
  return `https://x.com/${encodeURIComponent(post.authorHandle)}/status/${post.statusId}`;
}

function initialsAvatar(post: StoredPost): HTMLElement {
  const fallback = element('span', initialsFor(post.authorName, post.authorHandle), 'avatar avatar-initials');
  fallback.dataset.testid = 'avatar-initials';
  fallback.setAttribute('aria-hidden', 'true');
  return fallback;
}

// avatarUrl was validated against X's image CDNs by the shared schema before reaching here.
function avatar(post: StoredPost): HTMLElement {
  if (!post.avatarUrl) return initialsAvatar(post);
  const img = document.createElement('img');
  img.className = 'avatar';
  img.alt = '';
  img.referrerPolicy = 'no-referrer';
  img.dataset.testid = 'avatar';
  img.addEventListener('error', () => img.replaceWith(initialsAvatar(post)), { once: true });
  img.src = post.avatarUrl;
  return img;
}

function timeLink(post: StoredPost, now: number): HTMLAnchorElement {
  const link = document.createElement('a');
  link.className = 'post-time';
  link.href = postUrl(post);
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.dataset.testid = 'post-time-link';
  const relative = formatRelativeTime(post.postedAt, now);
  if (!relative || !post.postedAt) {
    link.textContent = 'Open on X';
    return link;
  }
  const time = element('time', relative) as HTMLTimeElement;
  time.dateTime = post.postedAt;
  link.title = formatAbsoluteTime(post.postedAt);
  link.append(time);
  return link;
}

function header(post: StoredPost, now: number, aside: HTMLElement[]): HTMLElement {
  const names = document.createElement('div');
  names.className = 'post-names';
  names.append(
    element('span', post.authorName || post.authorHandle, 'post-name'),
    element('span', `@${post.authorHandle}`, 'post-handle'),
    element('span', '·', 'post-dot'),
    timeLink(post, now),
  );
  const head = document.createElement('div');
  head.className = 'post-head';
  head.append(names, ...aside);
  return head;
}

function metricsLine(m: StoredPost['metrics']): string {
  return `${m.replies} replies · ${m.reposts} reposts · ${m.likes} likes · ${m.views} views`;
}

/** The captured post rendered like an X post: avatar, name, @handle, linked time, text, metrics. */
export function renderPostCard(post: StoredPost, aside: HTMLElement[] = [], now: number = Date.now()): HTMLElement {
  const card = document.createElement('div');
  card.className = 'post-card';
  const body = document.createElement('div');
  body.className = 'post-body';
  body.append(
    header(post, now, aside),
    element('p', post.text, 'post-text'),
    element('div', metricsLine(post.metrics), 'post-metrics'),
  );
  card.append(avatar(post), body);
  return card;
}
