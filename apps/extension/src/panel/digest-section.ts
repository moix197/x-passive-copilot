import { DigestViewSchema, type DigestIdea, type DigestTrend, type DigestView } from '@xc/shared/types';
import { copyButton, copyText, renderDraftActions, type DraftCallbacks } from './draft-actions';
import { element } from './dom';
import { mountPolled } from './voice-tab';

export interface DigestHandlers {
  load: () => Promise<unknown>;
  /** Resolves to an error message, or null when the new digest was generated. */
  onGenerate: () => Promise<string | null>;
  onPolishIdea: (ideaId: string) => Promise<void>;
  draftCallbacks: (ideaId: string) => DraftCallbacks;
}

function postLink(statusId: string): HTMLAnchorElement {
  const link = document.createElement('a');
  link.textContent = `Post ${statusId.slice(-4)}`;
  link.href = `https://x.com/i/status/${statusId}`;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

function renderTrend(trend: DigestTrend): HTMLElement {
  const row = document.createElement('article');
  row.className = 'post';
  row.dataset.testid = 'digest-trend';
  row.append(element('div', trend.title, 'post-head'), element('p', trend.summary, 'post-text'));
  for (const id of trend.statusIds) row.append(postLink(id), document.createTextNode(' '));
  return row;
}

function polishButton(idea: DigestIdea, handlers: DigestHandlers): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = 'Polish';
  b.dataset.testid = 'idea-polish';
  b.addEventListener('click', () => {
    b.disabled = true;
    b.textContent = 'Polishing...';
    void handlers.onPolishIdea(idea.id).catch(() => {
      b.disabled = false;
      b.textContent = 'Polish';
    });
  });
  return b;
}

function polishPart(idea: DigestIdea, handlers: DigestHandlers): HTMLElement[] {
  const polish = idea.polish;
  if (polish?.status === 'polishing') return [element('div', 'Polishing...', 'post-tags')];
  if (polish?.text) {
    const actions = renderDraftActions(polish.text, handlers.draftCallbacks(idea.id));
    const parts = [element('p', polish.text, 'flag-final'), actions];
    if (polish.status === 'needs_edit') {
      parts.push(element('div', `Needs edit: ${polish.violations.join(', ')}`, 'needs-edit'));
    }
    return parts;
  }
  const failed = polish?.error ? [element('div', `Polish failed: ${polish.error}`, 'post-tags')] : [];
  return [...failed, polishButton(idea, handlers)];
}

function renderIdea(idea: DigestIdea, handlers: DigestHandlers): HTMLElement {
  const row = document.createElement('article');
  row.className = 'post';
  row.dataset.testid = 'digest-idea';
  row.append(element('p', idea.text, 'flag-draft'), element('div', idea.feature, 'post-tags'), copyButton(idea.text, copyText));
  row.append(...polishPart(idea, handlers));
  return row;
}

export function renderDigest(view: DigestView, handlers: DigestHandlers): HTMLElement[] {
  const note = view.failed ? [element('p', 'Last refresh failed; showing the previous digest.', 'needs-edit')] : [];
  if (!view.digest) {
    return [...note, element('p', 'No digest yet. It refreshes after enough new posts are captured.', 'status')];
  }
  return [
    ...note,
    element('h2', 'Trends', 'voice-title'),
    ...view.digest.trends.map(renderTrend),
    element('h2', 'Post ideas', 'voice-title'),
    ...view.digest.ideas.map((idea) => renderIdea(idea, handlers)),
  ];
}

function generateControls(onGenerate: DigestHandlers['onGenerate']): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'digest-controls';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Generate new ideas';
  button.dataset.testid = 'digest-generate';
  const message = element('p', '', 'needs-edit');
  message.dataset.testid = 'digest-generate-error';
  message.setAttribute('role', 'alert');
  button.addEventListener('click', () => {
    button.disabled = true;
    button.textContent = 'Generating...';
    message.textContent = '';
    button.title = '';
    void onGenerate()
      .catch(() => 'Server offline.')
      .then((error) => {
        message.textContent = error ?? '';
        button.title = error ?? '';
        button.disabled = false;
        button.textContent = 'Generate new ideas';
      });
  });
  wrap.append(button, message);
  return wrap;
}

export function mountDigestSection(root: HTMLElement, handlers: DigestHandlers): () => void {
  const load = async () => DigestViewSchema.parse(await handlers.load());
  const polled = document.createElement('div');
  root.replaceChildren(generateControls(handlers.onGenerate), polled);
  const editing = () => polled.querySelector('textarea') !== null;
  return mountPolled(polled, load, (view) => renderDigest(view, handlers), editing);
}
