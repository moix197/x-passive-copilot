import type { StoredPost } from '@xc/shared/types';
import { canPolish, canRegenerate, currentDraft, type CurrentDraft } from '../../drafts/current-draft';
import { element } from '../../panel/dom';
import { copiedBadge, polishButton, renderDraftActions, type DraftCallbacks, type Rating } from '../../panel/draft-actions';
import panelCss from '../../panel/panel.css';
import inlineCss from './inline.css';
import { findHost, HOST_TAG, removeStaleHosts } from './own-nodes';

export interface InlineHandlers {
  /** Copies the text and records the copy; it never marks the post replied. */
  onCopy: (post: StoredPost, draft: CurrentDraft) => Promise<void>;
  onRate: (post: StoredPost, draft: CurrentDraft, rating: Rating) => Promise<string | null>;
  onPolish: (post: StoredPost) => Promise<void>;
  onRegenerate: (post: StoredPost) => Promise<void>;
}

export interface InlineContext {
  handlers: InlineHandlers;
  isExpanded: (statusId: string) => boolean;
  setExpanded: (statusId: string, open: boolean) => void;
}

interface HostState {
  card: HTMLElement;
  signature: string;
}

const hosts = new WeakMap<Element, HostState>();

// Events from our card must never reach X's handlers (an article click opens the post, keys are shortcuts).
const ISOLATED_EVENTS = [
  'click', 'dblclick', 'auxclick', 'contextmenu', 'mousedown', 'mouseup', 'pointerdown', 'pointerup',
  'touchstart', 'touchend', 'keydown', 'keyup', 'keypress',
];

function isolate(host: HTMLElement): void {
  for (const type of ISOLATED_EVENTS) host.addEventListener(type, (event) => event.stopPropagation());
}

function badgeButton(statusId: string, card: HTMLElement, ctx: InlineContext): HTMLButtonElement {
  const badge = document.createElement('button');
  badge.type = 'button';
  badge.className = 'inline-badge';
  badge.textContent = 'Draft ready';
  badge.dataset.testid = 'inline-draft-badge';
  badge.setAttribute('aria-expanded', String(!card.hidden));
  badge.addEventListener('click', () => {
    card.hidden = !card.hidden;
    badge.setAttribute('aria-expanded', String(!card.hidden));
    ctx.setExpanded(statusId, !card.hidden);
  });
  return badge;
}

function createHost(article: Element, statusId: string, ctx: InlineContext): HostState {
  const host = document.createElement(HOST_TAG);
  isolate(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = panelCss + inlineCss;
  const card = element('section', '', 'inline-card');
  card.dataset.testid = 'inline-draft-card';
  card.setAttribute('aria-label', 'Reply draft');
  card.hidden = !ctx.isExpanded(statusId);
  shadow.append(style, badgeButton(statusId, card, ctx), card);
  removeStaleHosts(article, null);
  article.append(host);
  const state = { card, signature: '' };
  hosts.set(host, state);
  return state;
}

function sectionHead(draft: CurrentDraft, copied: boolean): HTMLElement {
  const head = element('div', '', 'section-head');
  head.append(
    element('span', draft.kind === 'claude' ? 'Claude version' : 'First draft', 'section-label'),
    element('span', draft.kind === 'claude' ? 'polished' : 'triage model', 'section-sub'),
    ...(copied ? [copiedBadge()] : []),
  );
  return head;
}

function showCopied(head: HTMLElement): void {
  if (!head.querySelector('[data-testid="copied-badge"]')) head.append(copiedBadge());
}

function draftCallbacks(post: StoredPost, draft: CurrentDraft, head: HTMLElement, handlers: InlineHandlers): DraftCallbacks {
  return {
    rating: draft.rating,
    onCopy: async () => {
      await handlers.onCopy(post, draft);
      showCopied(head);
    },
    onRate: (rating) => handlers.onRate(post, draft, rating),
    ...(draft.kind === 'claude' && canRegenerate(post) ? { onRegenerate: () => handlers.onRegenerate(post) } : {}),
  };
}

// The First draft offers Polish (or shows it running); the Claude version offers Regenerate in its actions.
function roughExtras(post: StoredPost, handlers: InlineHandlers): HTMLElement[] {
  if (post.polish?.status === 'polishing') return [element('div', 'Polishing...', 'post-tags')];
  return canPolish(post) ? [polishButton(() => handlers.onPolish(post))] : [];
}

function renderSection(post: StoredPost, draft: CurrentDraft, handlers: InlineHandlers): HTMLElement {
  const box = element('section', '', `reply-section ${draft.kind === 'claude' ? 'claude-version' : 'first-draft'}`);
  const head = sectionHead(draft, post.copiedAt !== null);
  const text = element('p', draft.text, 'reply-text');
  text.dataset.testid = 'inline-draft-text';
  const actions = draft.busy
    ? [element('div', 'Regenerating...', 'post-tags')]
    : [renderDraftActions(draft.text, draftCallbacks(post, draft, head, handlers))];
  box.append(head, text, ...actions, ...(draft.kind === 'rough' ? roughExtras(post, handlers) : []));
  return box;
}

const signatureOf = (post: StoredPost, draft: CurrentDraft): string =>
  JSON.stringify([draft, post.copiedAt !== null, post.polish?.status ?? null, post.polish?.versions.length ?? 0]);

/** Ensures exactly one up-to-date card under this article; re-renders only when its draft changed. */
export function upsertInlineDraft(article: Element, post: StoredPost, ctx: InlineContext): void {
  const draft = currentDraft(post);
  if (!draft) return removeInlineDraft(article);
  const host = findHost(article);
  const state = (host && hosts.get(host)) || createHost(article, post.statusId, ctx);
  const signature = signatureOf(post, draft);
  if (state.signature === signature) return;
  state.signature = signature;
  state.card.replaceChildren(renderSection(post, draft, ctx.handlers));
}

export function removeInlineDraft(article: Element): void {
  removeStaleHosts(article, null);
}
