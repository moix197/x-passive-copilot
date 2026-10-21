import { IDEA_KINDS, ideaJobKey, type ComposeIdeasReply, type DigestIdea, type IdeaKind, type IdeaSourceInput } from '@xc/shared/types';
import { mergeIdeas } from '../../drafts/idea-list';
import { element } from '../../panel/dom';
import { copyButton, copyText } from '../../panel/draft-actions';
import { IDEA_KIND_LABELS, ideaMeta } from '../../panel/idea-meta';
import { draftingLabel } from './inline-pills';
import { finishIdeaRequest, followIdeaJob, runningJobFor, type IdeaJobHooks, type IdeaJobState } from './idea-job';
import { askComposeIdeas, newIdeaJobId } from './relay';

export interface IdeasCard {
  card: HTMLElement;
  /**
   * Lists the recent ideas again (digests and earlier generations); call on each open with the post quoted in
   * that composer (X's Quote), or null. While quoting, Generate makes a quote idea for it and the kind chips hide.
   */
  refresh: (quoted: IdeaSourceInput | null) => void;
}

interface CardState extends IdeaJobState {
  ideas: DigestIdea[];
  /** The kind Generate asks for; null is Mix (the server's rotation). */
  kind: IdeaKind | null;
  /** The post quoted in the open composer; null outside X's Quote composer. */
  quoted: IdeaSourceInput | null;
}

function generateButton(state: CardState, onGenerate: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.testid = 'compose-idea-generate';
  button.textContent = state.generating ? 'Generating…' : 'Generate idea';
  button.disabled = state.generating;
  button.addEventListener('click', onGenerate);
  return button;
}

function cardHead(state: CardState, onGenerate: () => void): HTMLElement {
  const head = element('div', '', 'section-head');
  head.append(element('span', 'Post ideas', 'section-label'), generateButton(state, onGenerate));
  return head;
}

function kindChip(label: string, kind: IdeaKind | null, state: CardState, onPick: (kind: IdeaKind | null) => void): HTMLButtonElement {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.textContent = label;
  chip.dataset.testid = `compose-idea-kind-${kind ?? 'mix'}`;
  chip.setAttribute('aria-pressed', String(state.kind === kind));
  chip.addEventListener('click', () => onPick(kind));
  return chip;
}

function kindChips(state: CardState, onPick: (kind: IdeaKind | null) => void): HTMLElement {
  const bar = element('div', '', 'feed-toggle kind-chips');
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Idea kind');
  const chips = IDEA_KINDS.map((kind) => kindChip(IDEA_KIND_LABELS[kind], kind, state, onPick));
  bar.append(kindChip('Mix', null, state, onPick), ...chips);
  return bar;
}

const QUOTING_EXCERPT_CHARS = 80;

function quotingLine(quoted: IdeaSourceInput): HTMLElement {
  const excerpt = quoted.text.replace(/\s+/g, ' ').slice(0, QUOTING_EXCERPT_CHARS);
  const line = element('p', `Quoting @${quoted.authorHandle}: ${excerpt}`, 'idea-source');
  line.dataset.testid = 'compose-quoting';
  line.title = quoted.text;
  return line;
}

// Inside X's Quote composer the idea is always a quote of that post, so there is no kind to pick.
const kindControls = (state: CardState, onPick: (kind: IdeaKind | null) => void): HTMLElement =>
  state.quoted ? quotingLine(state.quoted) : kindChips(state, onPick);

/** Why the last request gave nothing (with the full reason as title), shown as a live status line. */
export function noteLine(note: Pick<CardState, 'note' | 'noteTitle'>, testId: string): HTMLElement {
  const line = element('p', note.note, 'post-tags');
  line.dataset.testid = testId;
  line.setAttribute('role', 'status');
  line.title = note.noteTitle;
  return line;
}

/** One idea with its kind tag, source line and Copy; test ids `<testId>` and `<testId>-text`. */
export function ideaRow(idea: DigestIdea, testId = 'compose-idea'): HTMLElement {
  const row = element('article', '', 'reply-section');
  row.dataset.testid = testId;
  const text = element('p', idea.text, 'reply-text');
  text.dataset.testid = `${testId}-text`;
  row.append(text, ...ideaMeta(idea), copyButton(idea.text, copyText));
  return row;
}

function ideaRows(state: CardState): HTMLElement[] {
  if (state.ideas.length > 0) return state.ideas.map((idea) => ideaRow(idea));
  return state.generating ? [] : [element('p', 'No ideas yet. Generate one to copy into your post.', 'status')];
}

const askGenerate = (state: CardState, jobId: string): Promise<ComposeIdeasReply> =>
  state.quoted
    ? askComposeIdeas('generate', 'quote', state.quoted, jobId)
    : askComposeIdeas('generate', state.kind ?? undefined, undefined, jobId);

// Listing failed (offline): the reason shows as the status line.
function replyNote(reply: ComposeIdeasReply): Pick<CardState, 'note' | 'noteTitle'> {
  return { note: reply.error ? (reply.resumesAt ? draftingLabel(reply.resumesAt) : reply.error) : '', noteTitle: reply.error ?? '' };
}

function applyReply(state: CardState, reply: ComposeIdeasReply): void {
  state.ideas = mergeIdeas(state.ideas, reply.ideas);
  Object.assign(state, replyNote(reply));
}

/** The compose popover's card: recent ideas newest first, each with Copy, and "Generate idea" adding one of the picked kind per click. */
export function createIdeasCard(): IdeasCard {
  const card = element('section', '', 'inline-card');
  card.dataset.testid = 'compose-ideas-card';
  card.setAttribute('aria-label', 'Post ideas');
  const state: CardState = { ideas: [], generating: false, kind: null, quoted: null, note: '', noteTitle: '', job: null, jobId: null };

  const pickKind = (kind: IdeaKind | null) => {
    state.kind = kind;
    render();
  };
  const render = () =>
    card.replaceChildren(
      cardHead(state, generate),
      kindControls(state, pickKind),
      noteLine(state, 'compose-ideas-status'),
      ...(state.job ? [state.job.box] : []),
      ...ideaRows(state),
    );

  const hooks: IdeaJobHooks = {
    render: () => render(),
    retry: () => generate(),
    cancel: () => cancel(),
    onIdea: (idea) => (state.ideas = mergeIdeas(state.ideas, [idea])),
  };

  function cancel(): void {
    state.job?.stop();
    Object.assign(state, { generating: false, jobId: null, job: null });
    render();
  }

  function generate(): void {
    const jobId = newIdeaJobId();
    followIdeaJob(state, jobId, hooks);
    void askGenerate(state, jobId).then((reply) => finishIdeaRequest(state, jobId, reply, hooks));
  }

  // A generation still running for this composer (the page was reloaded) shows its steps again.
  const reattach = (quoted: IdeaSourceInput | null) =>
    void runningJobFor(ideaJobKey(quoted, quoted ? 'quote' : undefined)).then((job) => {
      if (job && !state.generating) followIdeaJob(state, job.id, hooks, job);
    });

  const refresh = (quoted: IdeaSourceInput | null) => {
    state.quoted = quoted;
    render();
    reattach(quoted);
    void askComposeIdeas('list').then((reply) => {
      applyReply(state, reply);
      render();
    });
  };
  render();
  return { card, refresh };
}
