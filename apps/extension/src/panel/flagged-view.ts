import { MAX_DRAFT_VERSIONS, type DraftVersion, type PolishInfo, type StoredPost } from '@xc/shared/types';
import { element } from './dom';
import { renderDraftActions, type DraftCallbacks, type Rating } from './draft-actions';
import { renderPostCard } from './post-card';
import { mountPostsView, type PostsViewOptions } from './posts-view';
import { renderVersionNav } from './version-nav';

export type PolishHandler = (statusId: string) => Promise<void>;

export interface FlaggedHandlers {
  /** Marks or un-marks a post replied; the owner of the feeds moves the card immediately. */
  onSetReplied: (statusId: string, replied: boolean) => Promise<void>;
  onPolish: PolishHandler;
  onRegenerate: PolishHandler;
  onSelectVersion: (statusId: string, versionId: number) => Promise<void>;
  draftCallbacks: (statusId: string, saved: Rating | null) => DraftCallbacks;
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

// Copying any draft means the user is about to reply, so the post moves to Replied.
function copyMarksReplied(post: StoredPost, callbacks: DraftCallbacks, ctx: RowContext): DraftCallbacks {
  if (post.repliedAt !== null) return callbacks;
  return {
    ...callbacks,
    onCopy: async (text) => {
      await callbacks.onCopy(text);
      void ctx.handlers.onSetReplied(post.statusId, true).catch(() => undefined);
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
  bar.append(button);
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

function triageStatus(t: NonNullable<StoredPost['triage']>): HTMLElement[] {
  if (t.error) return [element('div', 'triage error', 'post-tags')];
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
  return renderDraftActions(text.textContent ?? '', copyMarksReplied(post, callbacks, ctx), trackEditing(ctx, post.statusId, 'rough'));
}

function firstDraftSection(post: StoredPost, ctx: RowContext): HTMLElement | null {
  const t = post.triage;
  if (!t) return null;
  const box = section('first-draft', 'First draft', 'triage model');
  box.append(...triageStatus(t));
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
  const versions = post.polish?.versions.length ?? 0;
  const base = handlers.draftCallbacks(post.statusId, post.polish?.feedback ?? null);
  const callbacks: DraftCallbacks = {
    ...base,
    onEdit: async (edited) => {
      const error = await base.onEdit(edited);
      if (!error) showEdited(post, edited, ctx);
      return error;
    },
    ...(versions < MAX_DRAFT_VERSIONS ? { onRegenerate: () => handlers.onRegenerate(post.statusId) } : {}),
  };
  return renderDraftActions(text, copyMarksReplied(post, callbacks, ctx), trackEditing(ctx, post.statusId, 'claude'));
}

// While a regenerate runs, the selected version stays readable but cannot be acted on.
function finalReply(post: StoredPost, polish: PolishInfo & { text: string }, ctx: RowContext): HTMLElement[] {
  const reply = element('p', polish.text, 'reply-text');
  reply.dataset.testid = 'claude-text';
  const busy = polish.status === 'polishing';
  const parts = [reply, busy ? element('div', 'Regenerating...', 'post-tags') : draftActionsFor(post, polish.text, ctx)];
  if (polish.violations.length) parts.push(element('div', `Needs edit: ${polish.violations.join(', ')}`, 'needs-edit'));
  if (polish.error) parts.push(element('div', `Regenerate failed: ${polish.error}`, 'needs-edit'));
  return parts;
}

function canPolish(post: StoredPost): boolean {
  const t = post.triage;
  // A must-flag post stays polishable even when its triage errored.
  return Boolean(t && !t.skipReason && (!t.error || t.mustFlag !== null));
}

function claudeBody(post: StoredPost, ctx: RowContext): HTMLElement[] {
  const polish = post.polish;
  if (polish?.text && polish.status !== 'error') return finalReply(post, { ...polish, text: polish.text }, ctx);
  if (polish?.status === 'polishing') return [element('div', 'Polishing...', 'post-tags')];
  const note = polish?.status === 'cap_reached' ? 'Daily cap reached' : polish?.error ? `Polish failed: ${polish.error}` : '';
  return [...(note ? [element('div', note, 'post-tags')] : []), ...(canPolish(post) ? [polishButton(post, ctx.handlers.onPolish)] : [])];
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
  options: Pick<PostsViewOptions, 'load' | 'emptyText'> & FlaggedHandlers,
): () => void {
  const editors: OpenEditors = new Map();
  const load = async () => {
    const posts = await options.load();
    forgetDepartedEditors(editors, posts);
    return posts;
  };
  const render = (post: StoredPost) => editors.get(post.statusId)?.row ?? renderFlagged(post, options, editors);
  return mountPostsView(root, { load, render, emptyText: options.emptyText });
}
