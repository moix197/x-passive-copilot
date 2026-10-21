import { element } from '../../panel/dom';
import { formatAbsoluteTime } from '../../panel/post-format';
import { attachHost, keepInActionBar } from './inline-card';
import { findHost } from './own-nodes';

export type StatusTone = 'pending' | 'muted';
type FlagHandler = (statusId: string) => Promise<string | null>;
/** Builds the small "Post idea" button shown beside the pill. */
export type IdeaButton = () => HTMLElement;

/** What each pill host shows, so an unchanged pill is kept and a changed one is rebuilt. */
const pillKeys = new WeakMap<Element, string>();

function reuseHost(article: Element, key: string): boolean {
  const host = findHost(article);
  if (!host || pillKeys.get(host) !== key) return false;
  keepInActionBar(article, host);
  return true;
}

function mountPill(article: Element, key: string, ...nodes: HTMLElement[]): void {
  pillKeys.set(attachHost(article, ...nodes), key);
}

/** "Drafting…" while a flagged post waits for triage, or when it resumes after a quota pause. */
export function draftingLabel(pausedUntil: number | null): string {
  return pausedUntil ? `Paused · resumes ${formatAbsoluteTime(new Date(pausedUntil).toISOString())}` : 'Drafting…';
}

/** A read-only pill: a draft on the way (pending) or a post already replied to (muted). */
export function upsertStatusPill(article: Element, label: string, tone: StatusTone, ideaButton: IdeaButton): void {
  const key = `status:${tone}:${label}`;
  if (reuseHost(article, key)) return;
  const pill = element('span', label, `inline-badge inline-status ${tone}`);
  pill.dataset.testid = 'inline-status-pill';
  pill.setAttribute('role', 'status');
  mountPill(article, key, pill, ideaButton());
}

async function flag(button: HTMLButtonElement, statusId: string, onFlag: FlagHandler): Promise<void> {
  button.disabled = true;
  button.textContent = 'Drafting…';
  const error = await onFlag(statusId);
  if (!error) return;
  button.disabled = false;
  button.textContent = 'Flag failed';
  button.title = error;
}

function flagButton(statusId: string, onFlag: FlagHandler): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'inline-badge inline-flag';
  button.dataset.testid = 'inline-flag-pill';
  button.textContent = '+ Flag';
  button.title = 'Flag this post and draft a reply';
  button.addEventListener('click', () => void flag(button, statusId, onFlag));
  return button;
}

/** A subtle "+ Flag" on a captured post outside Flagged; once clicked it stays "Drafting…" until the next lookup. */
export function upsertFlagPill(article: Element, statusId: string, onFlag: FlagHandler, ideaButton: IdeaButton): void {
  const key = `flag:${statusId}`;
  if (reuseHost(article, key)) return;
  mountPill(article, key, flagButton(statusId, onFlag), ideaButton());
}
