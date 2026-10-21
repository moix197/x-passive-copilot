import { IDEA_KINDS, type ComposeIdeasReply, type DigestIdea, type IdeaKind } from '@xc/shared/types';
import { mergeIdeas } from '../../drafts/idea-list';
import { element } from '../../panel/dom';
import { copyButton, copyText } from '../../panel/draft-actions';
import { IDEA_KIND_LABELS, ideaMeta } from '../../panel/idea-meta';
import { draftingLabel } from './inline-pills';
import { askComposeIdeas } from './relay';

export interface IdeasCard {
  card: HTMLElement;
  /** Lists the recent ideas again (digests and earlier generations); call on each open. */
  refresh: () => void;
}

interface CardState {
  ideas: DigestIdea[];
  generating: boolean;
  /** The kind Generate asks for; null is Mix (the server's rotation). */
  kind: IdeaKind | null;
  /** Why the last request gave nothing: a refusal, or the quota pause's resume time. */
  note: string;
  noteTitle: string;
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

function noteLine(state: CardState): HTMLElement {
  const line = element('p', state.note, 'post-tags');
  line.dataset.testid = 'compose-ideas-status';
  line.setAttribute('role', 'status');
  line.title = state.noteTitle;
  return line;
}

function ideaRow(idea: DigestIdea): HTMLElement {
  const row = element('article', '', 'reply-section');
  row.dataset.testid = 'compose-idea';
  const text = element('p', idea.text, 'reply-text');
  text.dataset.testid = 'compose-idea-text';
  row.append(text, ...ideaMeta(idea), copyButton(idea.text, copyText));
  return row;
}

function ideaRows(state: CardState): HTMLElement[] {
  if (state.ideas.length > 0) return state.ideas.map(ideaRow);
  return state.generating ? [] : [element('p', 'No ideas yet. Generate one to copy into your post.', 'status')];
}

// A quota pause shows when generating resumes; any other refusal shows the server's reason.
function applyReply(state: CardState, reply: ComposeIdeasReply): void {
  state.ideas = mergeIdeas(state.ideas, reply.ideas);
  state.note = reply.error ? (reply.resumesAt ? draftingLabel(reply.resumesAt) : reply.error) : '';
  state.noteTitle = reply.error ?? '';
}

/** The compose popover's card: recent ideas newest first, each with Copy, and "Generate idea" adding one of the picked kind per click. */
export function createIdeasCard(): IdeasCard {
  const card = element('section', '', 'inline-card');
  card.dataset.testid = 'compose-ideas-card';
  card.setAttribute('aria-label', 'Post ideas');
  const state: CardState = { ideas: [], generating: false, kind: null, note: '', noteTitle: '' };

  const pickKind = (kind: IdeaKind | null) => {
    state.kind = kind;
    render();
  };
  const render = () =>
    card.replaceChildren(cardHead(state, generate), kindChips(state, pickKind), noteLine(state), ...ideaRows(state));
  const ask = async (action: 'list' | 'generate') => {
    applyReply(state, await askComposeIdeas(action, action === 'generate' ? (state.kind ?? undefined) : undefined));
    render();
  };

  function generate(): void {
    state.generating = true;
    state.note = 'Generating…';
    render();
    void ask('generate').finally(() => {
      state.generating = false;
      render();
    });
  }

  render();
  return { card, refresh: () => void ask('list') };
}
