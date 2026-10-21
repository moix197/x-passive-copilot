import type { DraftVersion, PolishInfo, StoredPost } from '@xc/shared/types';
import { canPolish, canRegenerate, polishedText } from '../drafts/current-draft';
import { element } from './dom';
import { polishProgressBox, type FetchJob } from './job-progress';
import { copiedBadge, polishButton, renderDraftActions, type DraftCallbacks, type EditableDraftCallbacks, type Rating } from './draft-actions';
import { renderPostCard } from './post-card';
import { mountPostsView, type PostsViewOptions } from './posts-view';
import { renderVersionNav } from './version-nav';

export type PolishHandler = (statusId: string) => Promise<void>;

export interface FlaggedHandlers {
  /** Marks or un-marks a post replied; the owner of the feeds moves the card immediately. */
  onSetReplied: (statusId: string, replied: boolean) => Promise<void>;
  /** Records the copy and brings the post up on X; the card stays where it is. */
  onCopied: (post: StoredPost) => Promise<void>;
  onPolish: PolishHandler;
  /** Re-queues a failed triage; resolves to why it was refused, or null when queued. */
  onRetriage: (statusId: string) => Promise<string | null>;
  onRegenerate: PolishHandler;
  onSelectVersion: (statusId: string, versionId: number) => Promise<void>;
  draftCallbacks: (statusId: string, saved: Rating | null) => EditableDraftCallbacks;
  /** Reads a polish job's steps, shown while it runs. */
  fetchJob: FetchJob;
}

type DraftKind = 'rough' | 'claude';

/** Rows with at least one open editor, kept across polls so typing is not wiped. */
type OpenEditors = Map<string, { row: HTMLElement; kinds: Set<DraftKind> }>;

interface RowContext {
  handlers: FlaggedHandlers;
  editors: OpenEditors;
  row: HTMLElement;
}

function flagTags(post: StoredPost): string {
  const t = post.triage;
  const tags = [t?.mustFlag ?? '', post.isReply ? 'reply' : '', post.quotedStatusId ? 'quote' : ''];
  return tags.filter(Boolean).join(' · ');
}

function scoreBadge(post: StoredPost): HTMLElement {
  const score = post.triage?.score;
  const badge = element('span', score === null || score === undefined ? '—' : String(Math.round(score)), 'score-badge');
  badge.title = 'Triage score';
  return badge;
}

// Rows are rebuilt every poll, so a copy is remembered here until the server's copiedAt catches up.
const sessionCopied = new Set<string>();

const wasCopied = (post: StoredPost) => post.copiedAt !== null || sessionCopied.has(post.statusId);

function showCopied(row: HTMLElement): void {
  const bar = row.querySelector('.replied-actions');
  if (bar && !bar.querySelector('[data-testid="copied-badge"]')) bar.append(copiedBadge());
}

// Copying does not mean the reply was posted, so the card stays put until Mark replied.
function copyMarksCopied(post: StoredPost, callbacks: DraftCallbacks, ctx: RowContext): DraftCallbacks {
  return {
    ...callbacks,
    onCopy: async (text) => {
      await callbacks.onCopy(text);
      sessionCopied.add(post.statusId);
      showCopied(ctx.row);
      void ctx.handlers.onCopied(post).catch(() => undefined);
    },
  };
}

function repliedButton(post: StoredPost, onSetReplied: FlaggedHandlers['onSetReplied']): HTMLElement {
  const replied = post.repliedAt !== null;
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = replied ? 'Move back to To reply' : 'Mark replied';
  button.dataset.testid = replied ? 'move-back' : 'mark-replied';
  button.addEventListener('click', () => void onSetReplied(post.statusId, !replied).catch(() => undefined));
  const bar = element('div', '', 'replied-actions');
  bar.append(button, ...(wasCopied(post) ? [copiedBadge()] : []));
  return bar;
}

function section(kind: string, title: string, subtitle: string, extra: HTMLElement[] = []) {
  const box = document.createElement('section');
  box.className = `reply-section ${kind}`;
  box.dataset.testid = kind;
  box.setAttribute('aria-label', title);
  const head = document.createElement('div');
  head.className = 'section-head';
  head.append(element('span', title, 'section-label'), element('span', subtitle, 'section-sub'), ...extra);
  box.append(head);
  return box;
}

function originalPost(post: StoredPost): HTMLElement {
  const box = document.createElement('section');
  box.className = 'original-post';
  box.dataset.testid = 'original-post';
  box.setAttribute('aria-label', 'Original post');
  box.append(renderPostCard(post, [scoreBadge(post)]));
  const tags = flagTags(post);
  if (tags) box.append(element('div', tags, 'post-tags'));
  return box;
}

// Rows are rebuilt every poll, so a refusal is remembered here until the next retry or success.
const retryRefusals = new Map<string, string>();

function retryButton(statusId: string, onRetriage: FlaggedHandlers['onRetriage']): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Retry';
  button.dataset.testid = 'retriage-button';
  button.addEventListener('click', () => {
    button.disabled = true;
    button.textContent = 'Retrying...';
    retryRefusals.delete(statusId);
    void onRetriage(statusId)
      .catch(() => 'Server offline.')
      .then((refusal) => {
        if (!refusal) return;
        retryRefusals.set(statusId, refusal);
        button.disabled = false;
        button.textContent = 'Retry';
        button.after(element('div', refusal, 'needs-edit'));
      });
  });
  return button;
}

function triageFailed(post: StoredPost, onRetriage: FlaggedHandlers['onRetriage']): HTMLElement[] {
  const refusal = retryRefusals.get(post.statusId);
  return [
    element('div', 'triage error', 'post-tags'),
    retryButton(post.statusId, onRetriage),
    ...(refusal ? [element('div', refusal, 'needs-edit')] : []),
  ];
}

function triageStatus(post: StoredPost, t: NonNullable<StoredPost['triage']>, onRetriage: FlaggedHandlers['onRetriage']): HTMLElement[] {
  if (t.error) return triageFailed(post, onRetriage);
  if (t.score === null && !t.skipReason) return [element('div', 'triage pending', 'post-tags')];
  return t.roughDraft ? [] : [element('div', 'No draft suggested.', 'post-tags')];
}

// A row stays pinned while any of its editors is open, so closing one never wipes the other.
function trackEditing(ctx: RowContext, statusId: string, kind: DraftKind): (editing: boolean) => void {
  return (editing) => {
    const open = ctx.editors.get(statusId)?.kinds ?? new Set<DraftKind>();
    if (editing) open.add(kind);
    else open.delete(kind);
    if (open.size) ctx.editors.set(statusId, { row: ctx.row, kinds: open });
    else ctx.editors.delete(statusId);
  };
}

function forgetDepartedEditors(editors: OpenEditors, posts: StoredPost[]): void {
  const present = new Set(posts.map((post) => post.statusId));
  for (const statusId of [...editors.keys()]) if (!present.has(statusId)) editors.delete(statusId);
}

// The rough draft is rated and edited under its own `rough-<statusId>` key, apart from the Claude version.
function roughDraftActions(post: StoredPost, text: HTMLElement, rating: Rating | null, ctx: RowContext): HTMLElement {
  const key = `rough-${post.statusId}`;
  const base = ctx.handlers.draftCallbacks(key, rating);
  const callbacks: DraftCallbacks = {
    ...base,
    onEdit: async (edited) => {
      const error = await base.onEdit(edited);
      if (!error) text.textContent = edited;
      return error;
    },
  };
  return renderDraftActions(text.textContent ?? '', copyMarksCopied(post, callbacks, ctx), trackEditing(ctx, post.statusId, 'rough'));
}

function firstDraftSection(post: StoredPost, ctx: RowContext): HTMLElement | null {
  const t = post.triage;
  if (!t) return null;
  const box = section('first-draft', 'First draft', 'triage model');
  box.append(...triageStatus(post, t, ctx.handlers.onRetriage));
  if (t.reason) box.append(element('p', t.reason, 'flag-reason'));
  if (t.roughDraft) {
    const text = element('p', t.roughDraft, 'reply-text');
    box.append(text, roughDraftActions(post, text, t.feedback, ctx));
  }
  if (t.roughDraftWarnings.length) {
    box.append(element('div', `draft warning: ${t.roughDraftWarnings.join(', ')}`, 'needs-edit'));
  }
  return box;
}

function withVersion(post: StoredPost, polish: PolishInfo, version: DraftVersion): StoredPost {
  const { text, status, violations } = version;
  return { ...post, polish: { ...polish, text, status, violations, error: null, selectedVersion: version.id } };
}

function showVersion(post: StoredPost, polish: PolishInfo, version: DraftVersion, ctx: RowContext): void {
  ctx.editors.delete(post.statusId);
  ctx.row.replaceWith(renderFlagged(withVersion(post, polish, version), ctx.handlers, ctx.editors));
}

function selectVersion(post: StoredPost, polish: PolishInfo, version: DraftVersion, ctx: RowContext): void {
  void ctx.handlers
    .onSelectVersion(post.statusId, version.id)
    .then(() => showVersion(post, polish, version, ctx))
    .catch(() => undefined);
}

// A saved edit passed the guard and replaced the selected version's text on the server.
function showEdited(post: StoredPost, text: string, ctx: RowContext): void {
  const polish = post.polish;
  if (!polish) return;
  const edited: DraftVersion = { id: polish.selectedVersion ?? 0, text, status: 'ready', violations: [] };
  const versions = polish.versions.map((v) => (v.id === edited.id ? edited : v));
  showVersion(post, { ...polish, versions }, edited, ctx);
}

function draftActionsFor(post: StoredPost, text: string, ctx: RowContext): HTMLElement {
  const { handlers } = ctx;
  const base = handlers.draftCallbacks(post.statusId, post.polish?.feedback ?? null);
  const callbacks: DraftCallbacks = {
    ...base,
    onEdit: async (edited) => {
      const error = await base.onEdit(edited);
      if (!error) showEdited(post, edited, ctx);
      return error;
    },
    ...(canRegenerate(post) ? { onRegenerate: () => handlers.onRegenerate(post.statusId) } : {}),
  };
  return renderDraftActions(text, copyMarksCopied(post, callbacks, ctx), trackEditing(ctx, post.statusId, 'claude'));
}

// While a regenerate runs, the selected version stays readable but cannot be acted on.
function finalReply(post: StoredPost, polish: PolishInfo & { text: string }, ctx: RowContext): HTMLElement[] {
  const reply = element('p', polish.text, 'reply-text');
  reply.dataset.testid = 'claude-text';
  const busy = polish.status === 'polishing';
  const running = () => polishProgressBox(post.statusId, { regenerating: true, fetchJob: ctx.handlers.fetchJob, unknown: 'queued' });
  const parts = [reply, busy ? running() : draftActionsFor(post, polish.text, ctx)];
  if (polish.violations.length) parts.push(element('div', `Needs edit: ${polish.violations.join(', ')}`, 'needs-edit'));
  if (polish.error) parts.push(element('div', `Regenerate failed: ${polish.error}`, 'needs-edit'));
  return parts;
}

function claudeBody(post: StoredPost, ctx: RowContext): HTMLElement[] {
  const polish = post.polish;
  const text = polishedText(polish);
  if (polish && text) return finalReply(post, { ...polish, text }, ctx);
  if (polish?.status === 'polishing') {
    return [polishProgressBox(post.statusId, { regenerating: false, fetchJob: ctx.handlers.fetchJob, unknown: 'queued' })];
  }
  const note = polish?.status === 'cap_reached' ? 'Daily cap reached' : polish?.error ? `Polish failed: ${polish.error}` : '';
  return [...(note ? [element('div', note, 'post-tags')] : []), ...(canPolish(post) ? [polishButton(() => ctx.handlers.onPolish(post.statusId))] : [])];
}

function claudeSection(post: StoredPost, ctx: RowContext): HTMLElement | null {
  const polish = post.polish;
  if (!polish && !canPolish(post)) return null;
  const extra: HTMLElement[] = polish?.topPick ? [element('span', 'Top pick', 'top-pick')] : [];
  if (polish && polish.status !== 'polishing') {
    const nav = renderVersionNav(polish.versions, polish.selectedVersion, (v) => selectVersion(post, polish, v, ctx));
    if (nav) extra.push(nav);
  }
  const box = section('claude-version', 'Claude version', 'polished', extra);
  box.append(...claudeBody(post, ctx));
  return box;
}

export function renderFlagged(
  post: StoredPost,
  handlers: FlaggedHandlers,
  editors: OpenEditors = new Map(),
): HTMLElement {
  const row = document.createElement('article');
  row.className = 'post flagged';
  row.dataset.testid = 'flagged-row';
  row.dataset.statusId = post.statusId;
  const ctx: RowContext = { handlers, editors, row };
  const sections = [originalPost(post), firstDraftSection(post, ctx), claudeSection(post, ctx)];
  row.append(...sections.filter((s): s is HTMLElement => s !== null), repliedButton(post, handlers.onSetReplied));
  return row;
}

export function mountFlaggedView(
  root: HTMLElement,
  options: Pick<PostsViewOptions, 'load' | 'emptyText' | 'bindRefresh'> & FlaggedHandlers,
): () => void {
  const editors: OpenEditors = new Map();
  const load = async () => {
    const posts = await options.load();
    forgetDepartedEditors(editors, posts);
    return posts;
  };
  const render = (post: StoredPost) => editors.get(post.statusId)?.row ?? renderFlagged(post, options, editors);
  return mountPostsView(root, { load, render, emptyText: options.emptyText, bindRefresh: options.bindRefresh });
}
