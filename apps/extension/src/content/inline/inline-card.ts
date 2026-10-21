import type { StoredPost } from '@xc/shared/types';
import { canPolish, canRegenerate, currentDraft, type CurrentDraft } from '../../drafts/current-draft';
import { element } from '../../panel/dom';
import { copiedBadge, polishButton, renderDraftActions, type DraftCallbacks, type Rating } from '../../panel/draft-actions';
import panelCss from '../../panel/panel.css';
import { SEL } from '../selectors';
import inlineCss from './inline.css';
import { adoptOpenCard, closePopover, isPopoverOpenFor, openCardFor, openPopover } from './inline-popover';
import { findHost, HOST_TAG, isolate, removeStaleHosts } from './own-nodes';

export interface InlineHandlers {
  /** Copies the text and records the copy; it never marks the post replied. */
  onCopy: (post: StoredPost, draft: CurrentDraft) => Promise<void>;
  onRate: (post: StoredPost, draft: CurrentDraft, rating: Rating) => Promise<string | null>;
  onPolish: (post: StoredPost) => Promise<void>;
  onRegenerate: (post: StoredPost) => Promise<void>;
}

export interface InlineContext {
  handlers: InlineHandlers;
}

interface HostState {
  card: HTMLElement;
  label: HTMLElement;
  signature: string;
}

const hosts = new WeakMap<Element, HostState>();
const SVG_NS = 'http://www.w3.org/2000/svg';

function sparkleIcon(): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'pill-icon');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z');
  svg.append(path);
  return svg;
}

function newCard(): HTMLElement {
  const card = element('section', '', 'inline-card');
  card.dataset.testid = 'inline-draft-card';
  card.setAttribute('aria-label', 'Reply draft');
  return card;
}

function pillButton(statusId: string, card: HTMLElement): { pill: HTMLButtonElement; label: HTMLElement } {
  const pill = document.createElement('button');
  pill.type = 'button';
  pill.className = 'inline-badge';
  pill.dataset.testid = 'inline-draft-badge';
  pill.setAttribute('aria-expanded', 'false');
  pill.setAttribute('aria-haspopup', 'dialog');
  const label = element('span', 'Ready', 'pill-label');
  pill.append(sparkleIcon(), label);
  pill.addEventListener('click', () =>
    isPopoverOpenFor(pill) ? closePopover() : openPopover(statusId, pill, card, panelCss + inlineCss),
  );
  return { pill, label };
}

// The pill sits at the end of the action bar so it reads as part of the post; without a bar it ends the article.
function mountPoint(article: Element): Element {
  const bars = article.querySelectorAll(SEL.actionBar);
  return bars[bars.length - 1] ?? article;
}

function createHost(article: Element, statusId: string): HostState {
  const host = document.createElement(HOST_TAG);
  isolate(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = panelCss + inlineCss;
  const card = openCardFor(statusId) ?? newCard();
  const { pill, label } = pillButton(statusId, card);
  shadow.append(style, pill);
  removeStaleHosts(article, null);
  mountPoint(article).append(host);
  adoptOpenCard(statusId, pill);
  const state = { card, label, signature: '' };
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

const isDrafting = (post: StoredPost, draft: CurrentDraft): boolean => draft.busy || post.polish?.status === 'polishing';

/** Ensures exactly one up-to-date pill (and popover card) for this article; re-renders only when its draft changed. */
export function upsertInlineDraft(article: Element, post: StoredPost, ctx: InlineContext): void {
  const draft = currentDraft(post);
  if (!draft) return removeInlineDraft(article);
  const host = findHost(article);
  const state = (host && hosts.get(host)) || createHost(article, post.statusId);
  const mount = mountPoint(article);
  if (host && host.parentElement !== mount) mount.append(host);
  const signature = signatureOf(post, draft);
  if (state.signature === signature) return;
  state.signature = signature;
  state.label.textContent = isDrafting(post, draft) ? 'Drafting…' : 'Ready';
  state.card.replaceChildren(renderSection(post, draft, ctx.handlers));
}

export function removeInlineDraft(article: Element): void {
  removeStaleHosts(article, null);
}
