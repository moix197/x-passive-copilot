import { DigestViewSchema, type DigestIdea, type DigestTrend, type EarlierDigest, type DigestView } from '@xc/shared/types';
import { generatedText, refreshFailedText } from './digest-notice';
import { digestProgressBox, paintDigestProgress } from './digest-progress';
import { copyButton, copyText, renderDraftActions, type DraftCallbacks } from './draft-actions';
import { element } from './dom';
import { ideaMeta } from './idea-meta';
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
  row.append(element('p', idea.text, 'flag-draft'), ...ideaMeta(idea), copyButton(idea.text, copyText));
  row.append(...polishPart(idea, handlers));
  return row;
}

function noticeLine(text: string): HTMLElement {
  const note = element('p', text, 'needs-edit');
  note.dataset.testid = 'digest-failed';
  return note;
}

function generatedLine(createdAt: number, testId = 'digest-generated'): HTMLElement {
  const line = element('p', generatedText(createdAt), 'status');
  line.dataset.testid = testId;
  return line;
}

/** Whether earlier ideas are open; owned by the mount so it survives each poll re-render. */
export interface EarlierState {
  expanded: boolean;
}

function earlierGroup(digest: EarlierDigest, handlers: DigestHandlers): HTMLElement[] {
  return [generatedLine(digest.createdAt, 'digest-earlier-generated'), ...digest.ideas.map((idea) => renderIdea(idea, handlers))];
}

function earlierToggle(count: number, state: EarlierState, repaint: () => void): HTMLButtonElement {
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.dataset.testid = 'digest-show-more';
  toggle.textContent = state.expanded ? 'Hide earlier ideas' : `Show earlier ideas (${count})`;
  toggle.addEventListener('click', () => {
    state.expanded = !state.expanded;
    repaint();
  });
  return toggle;
}

function earlierIdeas(earlier: EarlierDigest[], handlers: DigestHandlers, state: EarlierState): HTMLElement[] {
  if (earlier.length === 0) return [];
  const box = document.createElement('div');
  const count = earlier.reduce((sum, d) => sum + d.ideas.length, 0);
  const repaint = () => {
    const groups = state.expanded ? earlier.flatMap((d) => earlierGroup(d, handlers)) : [];
    box.replaceChildren(...groups, earlierToggle(count, state, repaint));
  };
  repaint();
  return [box];
}

export function renderDigest(view: DigestView, handlers: DigestHandlers, state: EarlierState): HTMLElement[] {
  const note = view.failed ? [noticeLine(refreshFailedText(view))] : [];
  if (!view.digest) {
    return [...note, element('p', 'No digest yet. It refreshes after enough new posts are captured.', 'status')];
  }
  return [
    ...note,
    element('h2', 'Trends', 'voice-title'),
    ...view.digest.trends.map(renderTrend),
    element('h2', 'Post ideas', 'voice-title'),
    generatedLine(view.digest.createdAt),
    ...view.digest.ideas.map((idea) => renderIdea(idea, handlers)),
    ...earlierIdeas(view.earlier, handlers, state),
  ];
}

const ACTIVE_POLL_MS = 1000;
const IDLE_POLL_MS = 3000;

interface GenerateControls {
  root: HTMLElement;
  /** Server-side state from each poll, so the button and progress stay right after a remount or a lost request. */
  setServerState: (view: DigestView) => void;
  /** A run is being requested, running, or its outcome is still on screen: poll faster. */
  isActive: () => boolean;
}

function generateControls(onGenerate: DigestHandlers['onGenerate']): GenerateControls {
  const wrap = document.createElement('div');
  wrap.className = 'digest-controls';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Generate new ideas';
  button.dataset.testid = 'digest-generate';
  const message = element('p', '', 'needs-edit');
  message.dataset.testid = 'digest-generate-error';
  message.setAttribute('role', 'alert');
  const progress = digestProgressBox();
  let requesting = false;
  let serverRunning = false;
  const paint = () => {
    const busy = requesting || serverRunning;
    button.disabled = busy;
    button.textContent = busy ? 'Generating...' : 'Generate new ideas';
  };
  button.addEventListener('click', () => {
    requesting = true;
    message.textContent = '';
    button.title = '';
    paint();
    void onGenerate()
      .catch(() => 'Server offline.')
      .then((error) => {
        requesting = false;
        message.textContent = error ?? '';
        button.title = error ?? '';
        paint();
      });
  });
  wrap.append(button, message, progress);
  return {
    root: wrap,
    setServerState: (view) => {
      serverRunning = view.running;
      paintDigestProgress(progress, view.progress);
      paint();
    },
    isActive: () => requesting || serverRunning || !progress.hidden,
  };
}

export function mountDigestSection(root: HTMLElement, handlers: DigestHandlers): () => void {
  const controls = generateControls(handlers.onGenerate);
  const load = async () => {
    const view = DigestViewSchema.parse(await handlers.load());
    controls.setServerState(view);
    return view;
  };
  const polled = document.createElement('div');
  root.replaceChildren(controls.root, polled);
  const editing = () => polled.querySelector('textarea') !== null;
  const intervalMs = () => (controls.isActive() ? ACTIVE_POLL_MS : IDLE_POLL_MS);
  const earlier: EarlierState = { expanded: false };
  return mountPolled(polled, load, (view) => renderDigest(view, handlers, earlier), editing, intervalMs);
}
