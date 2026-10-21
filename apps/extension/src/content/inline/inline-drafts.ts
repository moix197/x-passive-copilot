import type { StoredPost } from '@xc/shared/types';
import { copyText } from '../../panel/draft-actions';
import { readArticleStatusId } from '../parse-article';
import { SEL } from '../selectors';
import { forgetOld, idsToFetch, markStale, nextRefreshMs, REFRESH_MS, storeLookup, type DraftCache } from './draft-cache';
import { closeDetachedPopover } from './inline-popover';
import { removeInlineDraft, upsertInlineDraft, type InlineContext, type InlineHandlers } from './inline-card';
import { fetchToReply, sendInlineAction } from './relay';

const SYNC_DELAY_MS = 400;
/** Floor between syncs, so ids still due (a lookup in flight) never spin the timer. */
const MIN_GAP_MS = 250;
/** Soon after an action, so the card shows "Polishing..." and then the new version. */
const AFTER_ACTION_MS = 300;

export interface InlineDrafts {
  /** Call on every relevant DOM change; a burst of changes syncs at most every SYNC_DELAY_MS. */
  schedule: () => void;
}

type Schedule = (delay?: number) => void;

function visibleArticles(): Map<string, Element> {
  const column = document.querySelector(SEL.primaryColumn);
  const byId = new Map<string, Element>();
  for (const article of Array.from(column?.querySelectorAll(SEL.article) ?? [])) {
    const statusId = readArticleStatusId(article);
    if (statusId) byId.set(statusId, article);
  }
  return byId;
}

// The earliest request wins, so constant X re-renders cannot postpone a sync forever.
function createScheduler(run: () => void): Schedule {
  let timer: number | undefined;
  let dueAt = 0;
  return (delay = SYNC_DELAY_MS) => {
    const at = Date.now() + delay;
    if (timer !== undefined && dueAt <= at) return;
    window.clearTimeout(timer);
    dueAt = at;
    timer = window.setTimeout(() => {
      timer = undefined;
      run();
    }, delay);
  };
}

/** Every action goes through the service worker; afterwards the card's post is looked up again. */
function inlineHandlers(refreshSoon: (post: StoredPost) => void): InlineHandlers {
  const runThenRefresh = async (action: 'polish' | 'regenerate', post: StoredPost) => {
    const error = await sendInlineAction(action, post.statusId, post.statusId);
    refreshSoon(post);
    if (error) throw new Error(error);
  };
  return {
    onCopy: async (post, draft) => {
      await copyText(draft.text);
      await sendInlineAction('copy', post.statusId, draft.draftId);
      refreshSoon(post);
    },
    onRate: async (post, draft, rating) => {
      const error = await sendInlineAction(rating, post.statusId, draft.draftId);
      if (!error) refreshSoon(post);
      return error;
    },
    onPolish: (post) => runThenRefresh('polish', post),
    onRegenerate: (post) => runThenRefresh('regenerate', post),
  };
}

function render(articles: Map<string, Element>, cache: DraftCache, ctx: InlineContext): void {
  for (const [statusId, article] of articles) {
    const post = cache.get(statusId)?.post;
    if (post) upsertInlineDraft(article, post, ctx);
    else removeInlineDraft(article);
  }
  closeDetachedPopover();
}

// Unreachable server or worker: keep what is shown and ask again after the refresh interval.
async function lookup(cache: DraftCache, ids: string[]): Promise<void> {
  const known = ids.flatMap((id) => cache.get(id)?.post ?? []);
  const posts = await fetchToReply(ids).catch(() => known);
  storeLookup(cache, ids, posts, Date.now());
}

function nextDelay(cache: DraftCache): number {
  if (document.visibilityState !== 'visible') return REFRESH_MS;
  return Math.max(MIN_GAP_MS, nextRefreshMs([...visibleArticles().keys()], cache, Date.now()));
}

/** "Ready" pills (with a popover card) in the action bar of X articles that are in To reply; the server is reached via the service worker. */
export function createInlineDrafts(): InlineDrafts {
  const cache: DraftCache = new Map();
  let syncing = false;
  const schedule = createScheduler(() => void sync());
  const ctx: InlineContext = {
    handlers: inlineHandlers((post) => {
      markStale(cache, post.statusId);
      schedule(AFTER_ACTION_MS);
    }),
  };

  async function sync(): Promise<void> {
    if (syncing) return;
    syncing = true;
    try {
      render(visibleArticles(), cache, ctx);
      const due = idsToFetch([...visibleArticles().keys()], cache, Date.now());
      if (due.length && document.visibilityState === 'visible') {
        await lookup(cache, due);
        render(visibleArticles(), cache, ctx);
      }
      forgetOld(cache, Date.now());
    } finally {
      syncing = false;
      schedule(nextDelay(cache));
    }
  }

  document.addEventListener('visibilitychange', () => schedule());
  return { schedule: () => schedule() };
}
