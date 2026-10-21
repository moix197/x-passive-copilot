import type { DigestIdea, IdeaSourceInput } from '@xc/shared/types';
import { element } from '../../panel/dom';
import panelCss from '../../panel/panel.css';
import type { JobProgressHandle } from '../../panel/job-progress';
import { ideaJobProgress, ideaRow, noteLine, settleIdeaJob } from './compose-card';
import inlineCss from './inline.css';
import { sparkleIcon } from './inline-card';
import { closePopover, isPopoverOpenFor, openPopover } from './inline-popover';
import { askComposeIdeas, newIdeaJobId } from './relay';

/** The post on screen as a manual idea's source; null when it is gone or has no text. */
export type ReadIdeaSource = (statusId: string) => IdeaSourceInput | null;

interface IdeaState {
  idea: DigestIdea | null;
  generating: boolean;
  note: string;
  noteTitle: string;
  job: JobProgressHandle | null;
  jobId: string | null;
}

// One section per post, so a re-rendered Ready card (or a new pill) keeps the generated idea.
const sections = new Map<string, HTMLElement>();
const MAX_SECTIONS = 50;
const GONE = 'Post no longer on screen.';

function generateButton(state: IdeaState, onGenerate: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.testid = 'post-idea-generate';
  button.textContent = state.generating ? 'Generating…' : state.idea ? 'Another idea' : 'Post idea';
  button.disabled = state.generating;
  button.addEventListener('click', onGenerate);
  return button;
}

function sectionHead(state: IdeaState, onGenerate: () => void): HTMLElement {
  const head = element('div', '', 'section-head');
  head.append(element('span', 'Post idea', 'section-label'), element('span', 'same theme', 'section-sub'), generateButton(state, onGenerate));
  return head;
}

function createSection(statusId: string, readSource: ReadIdeaSource): HTMLElement {
  const section = element('section', '', 'reply-section post-idea');
  section.dataset.testid = 'post-idea';
  section.setAttribute('aria-label', 'Post idea');
  const state: IdeaState = { idea: null, generating: false, note: '', noteTitle: '', job: null, jobId: null };
  const render = () =>
    section.replaceChildren(
      sectionHead(state, generate),
      noteLine(state, 'post-idea-status'),
      ...(state.job ? [state.job.box] : []),
      ...(state.idea ? [ideaRow(state.idea, 'post-idea-result')] : []),
    );
  const cancel = () => {
    state.job?.stop();
    Object.assign(state, { generating: false, jobId: null, job: null });
    render();
  };
  function generate(): void {
    const source = readSource(statusId);
    state.job?.stop();
    if (!source) {
      Object.assign(state, { note: GONE, noteTitle: '', job: null });
      return render();
    }
    const jobId = newIdeaJobId();
    Object.assign(state, { generating: true, note: '', noteTitle: '', jobId, job: ideaJobProgress(jobId, generate, cancel) });
    render();
    void askComposeIdeas('generate', 'inspired', source, jobId).then((reply) => {
      state.idea = reply.ideas[0] ?? state.idea;
      if (state.jobId === jobId) Object.assign(state, { generating: false, jobId: null, job: settleIdeaJob(state.job, reply) });
      render();
    });
  }
  render();
  return section;
}

/**
 * "Post idea" for one post: an original post (inspired) on the same theme as that exact post, with Copy; it is
 * also saved, so it shows in the panel Digest tab. Nothing is typed or clicked on X.
 */
export function postIdeaSection(statusId: string, readSource: ReadIdeaSource): HTMLElement {
  const kept = sections.get(statusId);
  if (kept) return kept;
  const section = createSection(statusId, readSource);
  sections.set(statusId, section);
  if (sections.size > MAX_SECTIONS) sections.delete(sections.keys().next().value ?? statusId);
  return section;
}

function ideaCard(section: HTMLElement): HTMLElement {
  const card = element('section', '', 'inline-card');
  card.dataset.testid = 'post-idea-card';
  card.setAttribute('aria-label', 'Post idea');
  card.append(section);
  return card;
}

/** A small sparkle button beside a "+ Flag" or status pill, opening the post's "Post idea" section in a popover. */
export function postIdeaButton(statusId: string, readSource: ReadIdeaSource): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'inline-badge inline-idea';
  button.dataset.testid = 'inline-post-idea';
  button.title = 'Post idea on the same theme';
  button.setAttribute('aria-label', 'Post idea');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-haspopup', 'dialog');
  button.append(sparkleIcon());
  button.addEventListener('click', () => {
    if (isPopoverOpenFor(button)) return closePopover();
    openPopover(`idea:${statusId}`, button, ideaCard(postIdeaSection(statusId, readSource)), panelCss + inlineCss);
  });
  return button;
}
