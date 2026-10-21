import type { FlaggedCounts, FlaggedFeed, StoredPost } from '@xc/shared/types';
import { element } from './dom';
import { mountFlaggedView, type FlaggedHandlers } from './flagged-view';

export interface FlaggedPage {
  posts: StoredPost[];
  counts: FlaggedCounts;
}

export interface FlaggedFeedsOptions extends FlaggedHandlers {
  load: (feed: FlaggedFeed, limit: number) => Promise<FlaggedPage>;
}

/** Posts per "Load more" step; each poll asks again for everything loaded so far. */
const PAGE_SIZE = 100;

const FEEDS: { feed: FlaggedFeed; label: string; testId: string; empty: string; count: (c: FlaggedCounts) => number }[] = [
  { feed: 'to_reply', label: 'To reply', testId: 'feed-to-reply', empty: 'Nothing to reply to.', count: (c) => c.toReply },
  { feed: 'replied', label: 'Replied', testId: 'feed-replied', empty: 'Nothing replied yet.', count: (c) => c.replied },
];

function toggleButton(testId: string, onPick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.testid = testId;
  button.addEventListener('click', onPick);
  return button;
}

/** To reply / Replied sub-feeds with live counts; moving a card updates the view before the server answers. */
export function mountFlaggedFeeds(root: HTMLElement, options: FlaggedFeedsOptions): () => void {
  let feed: FlaggedFeed = 'to_reply';
  let counts: FlaggedCounts = { toReply: 0, replied: 0 };
  let moves = 0;
  let limit = PAGE_SIZE;
  let loaded = 0;
  let refresh: () => void = () => undefined;
  const inflight = new Set<Promise<void>>();
  let disposeFeed: (() => void) | null = null;
  const bar = element('div', '', 'feed-toggle');
  const body = document.createElement('div');
  const buttons = FEEDS.map((entry) => toggleButton(entry.testId, () => showFeed(entry.feed)));
  bar.append(...buttons);
  const more = toggleButton('load-more', () => {
    limit += PAGE_SIZE;
    refresh();
  });
  more.className = 'load-more';
  more.textContent = 'Load more';
  more.hidden = true;
  root.replaceChildren(bar, body, more);

  const paintToggle = () =>
    FEEDS.forEach((entry, i) => {
      const button = buttons[i];
      if (!button) return;
      button.textContent = `${entry.label} (${entry.count(counts)})`;
      button.setAttribute('aria-pressed', String(entry.feed === feed));
    });

  // Counts are totals, so anything beyond what is loaded is still waiting on the server.
  const paintMore = () => {
    const total = FEEDS.find((entry) => entry.feed === feed)?.count(counts) ?? 0;
    more.hidden = total <= loaded;
  };

  // A load that overlaps a move would bring back the card just moved, so wait for the server and refetch.
  const load = async (): Promise<StoredPost[]> => {
    for (;;) {
      const startedAt = moves;
      await Promise.all(inflight);
      const page = await options.load(feed, limit);
      if (startedAt !== moves) continue;
      counts = page.counts;
      loaded = page.posts.length;
      paintToggle();
      paintMore();
      return page.posts;
    }
  };

  const moveCard = (statusId: string, replied: boolean): Promise<void> => {
    moves += 1;
    const delta = replied ? 1 : -1;
    counts = { toReply: counts.toReply - delta, replied: counts.replied + delta };
    loaded -= 1;
    paintToggle();
    paintMore();
    body.querySelector(`[data-status-id="${CSS.escape(statusId)}"]`)?.remove();
    const request = options.onSetReplied(statusId, replied).catch(() => undefined);
    inflight.add(request);
    void request.finally(() => inflight.delete(request));
    return request;
  };

  function showFeed(next: FlaggedFeed): void {
    disposeFeed?.();
    feed = next;
    limit = PAGE_SIZE;
    loaded = 0;
    more.hidden = true;
    paintToggle();
    const emptyText = FEEDS.find((entry) => entry.feed === next)?.empty;
    disposeFeed = mountFlaggedView(body, { ...options, onSetReplied: moveCard, load, emptyText, bindRefresh: (fn) => (refresh = fn) });
  }

  showFeed(feed);
  return () => disposeFeed?.();
}
