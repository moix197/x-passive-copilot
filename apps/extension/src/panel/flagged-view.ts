import type { PolishInfo, StoredPost } from '@xc/shared/types';
import { copyButton, copyText, renderDraftActions, type DraftCallbacks } from './draft-actions';
import { element, mountPostsView, openOnXLink, type PostsViewOptions } from './posts-view';

export type PolishHandler = (statusId: string) => Promise<void>;

export interface FlaggedHandlers {
  onPolish: PolishHandler;
  draftCallbacks: (statusId: string) => DraftCallbacks;
}

/** Rows with an open editor, kept across polls so typing is not wiped. */
type OpenEditors = Map<string, HTMLElement>;

function flagTags(post: StoredPost): string {
  const t = post.triage;
  const tags = [t?.mustFlag ?? '', post.isReply ? 'reply' : '', post.quotedStatusId ? 'quote' : ''];
  return tags.filter(Boolean).join(' · ');
}

function polishButton(post: StoredPost, onPolish: PolishHandler): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Polish';
  button.dataset.testid = 'polish-button';
  button.addEventListener('click', () => {
    button.disabled = true;
    button.textContent = 'Polishing...';
    void onPolish(post.statusId).catch(() => {
      button.disabled = false;
      button.textContent = 'Polish';
    });
  });
  return button;
}

function finalReply(polish: PolishInfo, actions: HTMLElement | null): HTMLElement[] {
  const parts: HTMLElement[] = [];
  if (polish.topPick) parts.push(element('span', 'Top pick', 'top-pick'));
  if (polish.text) parts.push(element('p', polish.text, 'flag-final'));
  if (actions) parts.push(actions);
  if (polish.status === 'needs_edit') parts.push(element('div', `Needs edit: ${polish.violations.join(', ')}`, 'needs-edit'));
  return parts;
}

function polishBody(post: StoredPost, onPolish: PolishHandler, actions: HTMLElement | null): HTMLElement[] {
  const polish = post.polish;
  const t = post.triage;
  if (polish?.status === 'polishing') return [element('div', 'Polishing...', 'post-tags')];
  if (polish?.status === 'ready' || polish?.status === 'needs_edit') return finalReply(polish, actions);
  const note = polish?.status === 'cap_reached' ? 'Daily cap reached' : polish?.error ? `Polish failed: ${polish.error}` : '';
  // A must-flag post stays polishable even when its triage errored.
  const canPolish = t && !t.skipReason && (!t.error || t.mustFlag !== null);
  return [...(note ? [element('div', note, 'post-tags')] : []), ...(canPolish ? [polishButton(post, onPolish)] : [])];
}

function triageBody(post: StoredPost, onPolish: PolishHandler, actions: HTMLElement | null): HTMLElement[] {
  const t = post.triage;
  if (!t) return [];
  const parts: HTMLElement[] = [];
  if (t.error) parts.push(element('div', 'triage error', 'post-tags'));
  if (t.reason) parts.push(element('p', t.reason, 'flag-reason'));
  if (t.roughDraft) parts.push(element('p', t.roughDraft, 'flag-draft'), copyButton(t.roughDraft, copyText));
  if (t.roughDraftWarnings.length) parts.push(element('div', `draft warning: ${t.roughDraftWarnings.join(', ')}`, 'needs-edit'));
  return [...parts, ...polishBody(post, onPolish, actions)];
}

function draftActionsFor(
  post: StoredPost,
  row: HTMLElement,
  handlers: FlaggedHandlers,
  editors: OpenEditors,
): HTMLElement | null {
  const text = post.polish?.text;
  if (!text) return null;
  const onEditing = (editing: boolean) => {
    if (editing) editors.set(post.statusId, row);
    else editors.delete(post.statusId);
  };
  return renderDraftActions(text, handlers.draftCallbacks(post.statusId), onEditing);
}

export function renderFlagged(
  post: StoredPost,
  handlers: FlaggedHandlers,
  editors: OpenEditors = new Map(),
): HTMLElement {
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
  row.append(...triageBody(post, handlers.onPolish, draftActionsFor(post, row, handlers, editors)), openOnXLink(post));
  return row;
}

export function mountFlaggedView(
  root: HTMLElement,
  options: Pick<PostsViewOptions, 'load'> & FlaggedHandlers,
): () => void {
  const editors: OpenEditors = new Map();
  const render = (post: StoredPost) => editors.get(post.statusId) ?? renderFlagged(post, options, editors);
  return mountPostsView(root, { load: options.load, render, emptyText: 'Nothing flagged yet.' });
}
