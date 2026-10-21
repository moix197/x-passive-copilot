import type { StoredPost, ToReplyByIdsResponse } from '@xc/shared/types';
import { currentDraft, isTriagePending } from '../../drafts/current-draft';
import { copyText } from '../../panel/draft-actions';
import { readArticleSource } from '../idea-source';
import { readArticleStatusId } from '../parse-article';
import { SEL } from '../selectors';
import {
  forgetOld,
  idsToFetch,
  keepAfterFailedLookup,
  markStale,
  nextRefreshMs,
  REFRESH_MS,
  storeLookup,
  type CacheEntry,
  type DraftCache,
} from './draft-cache';
import { closeDetachedPopover } from './inline-popover';
import { removeInlineDraft, upsertInlineDraft, type InlineContext, type InlineHandlers } from './inline-card';
import { draftingLabel, upsertFlagPill, upsertStatusPill } from './inline-pills';
import { postIdeaButton, postIdeaSection, type ReadIdeaSource } from './post-idea';
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
function inlineHandlers(refreshSoon: (statusId: string) => void): InlineHandlers {
  const runThenRefresh = async (action: 'polish' | 'regenerate', post: StoredPost) => {
    const error = await sendInlineAction(action, post.statusId, post.statusId);
    refreshSoon(post.statusId);
    if (error) throw new Error(error);
  };
  return {
    onCopy: async (post, draft) => {
      await copyText(draft.text);
      await sendInlineAction('copy', post.statusId, draft.draftId);
      refreshSoon(post.statusId);
    },
    onRate: async (post, draft, rating) => {
      const error = await sendInlineAction(rating, post.statusId, draft.draftId);
      if (!error) refreshSoon(post.statusId);
      return error;
    },
    onPolish: (post) => runThenRefresh('polish', post),
    onRegenerate: (post) => runThenRefresh('regenerate', post),
    onFlag: async (statusId) => {
      const error = await sendInlineAction('flag', statusId, statusId);
      refreshSoon(statusId);
      return error;
    },
  };
}

const readVisibleSource: ReadIdeaSource = (statusId) => {
  const article = visibleArticles().get(statusId);
  return article ? readArticleSource(article) : null;
};

// Ready with a draft; Drafting… (or the quota resume time) while triage runs; muted Replied; + Flag on the rest.
// Every captured post also gets "Post idea": inside the Ready card, else as a small button beside the pill.
function renderArticle(article: Element, statusId: string, entry: CacheEntry | undefined, ctx: InlineContext): void {
  const post = entry?.post;
  const idea = () => postIdeaButton(statusId, readVisibleSource);
  if (post && currentDraft(post)) return upsertInlineDraft(article, post, ctx);
  if (post && isTriagePending(post)) return upsertStatusPill(article, draftingLabel(ctx.triagePausedUntil()), 'pending', idea);
  if (!post && entry?.mark === 'replied') return upsertStatusPill(article, 'Replied', 'muted', idea);
  if (!post && entry?.mark === 'flaggable') return upsertFlagPill(article, statusId, ctx.handlers.onFlag, idea);
  removeInlineDraft(article);
}

function render(articles: Map<string, Element>, cache: DraftCache, ctx: InlineContext): void {
  for (const [statusId, article] of articles) renderArticle(article, statusId, cache.get(statusId), ctx);
  closeDetachedPopover();
}

// Unreachable server or worker: keep what is shown and ask again after the refresh interval.
async function lookup(cache: DraftCache, ids: string[]): Promise<ToReplyByIdsResponse | null> {
  const answer = await fetchToReply(ids).catch(() => null);
  if (answer) storeLookup(cache, ids, answer, Date.now());
  else keepAfterFailedLookup(cache, ids, Date.now());
  return answer;
}

function nextDelay(cache: DraftCache): number {
  if (document.visibilityState !== 'visible') return REFRESH_MS;
  return Math.max(MIN_GAP_MS, nextRefreshMs([...visibleArticles().keys()], cache, Date.now()));
}

/** Pills in the action bar of captured X articles (Ready with a popover card, Drafting…, Replied, + Flag); the server is reached via the service worker. */
export function createInlineDrafts(): InlineDrafts {
  const cache: DraftCache = new Map();
  let syncing = false;
  let triagePausedUntil: number | null = null;
  const schedule = createScheduler(() => void sync());
  const ctx: InlineContext = {
    handlers: inlineHandlers((statusId) => {
      markStale(cache, statusId);
      schedule(AFTER_ACTION_MS);
    }),
    triagePausedUntil: () => triagePausedUntil,
    ideaSection: (statusId) => postIdeaSection(statusId, readVisibleSource),
  };

  async function sync(): Promise<void> {
    if (syncing) return;
    syncing = true;
    try {
      render(visibleArticles(), cache, ctx);
      const due = idsToFetch([...visibleArticles().keys()], cache, Date.now());
      if (due.length && document.visibilityState === 'visible') {
        const answer = await lookup(cache, due);
        if (answer) triagePausedUntil = answer.triagePausedUntil;
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
