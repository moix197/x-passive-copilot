import { element } from './posts-view';

const COPIED_MS = 1500;
const THUMBS_UP = String.fromCodePoint(0x1f44d);
const THUMBS_DOWN = String.fromCodePoint(0x1f44e);

export type Rating = 'up' | 'down';

export interface DraftCallbacks {
  onCopy: (text: string) => Promise<void>;
  /** Resolves to an error message to show, or null when the edit was accepted. */
  onEdit: (text: string) => Promise<string | null>;
  onRate: (rating: Rating) => Promise<void>;
}

const NOOP = (): void => undefined;

function button(label: string, testId: string, onClick: (b: HTMLButtonElement) => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.dataset.testid = testId;
  b.addEventListener('click', () => onClick(b));
  return b;
}

export const copyText = (text: string): Promise<void> => navigator.clipboard.writeText(text);

export function copyButton(text: string, onCopy: (text: string) => Promise<void>): HTMLButtonElement {
  return button('Copy', 'draft-copy', (b) => {
    void onCopy(text).then(() => {
      b.textContent = 'Copied';
      setTimeout(() => (b.textContent = 'Copy'), COPIED_MS);
    });
  });
}

function rateButton(rating: Rating, callbacks: DraftCallbacks): HTMLButtonElement {
  const b = button(rating === 'up' ? THUMBS_UP : THUMBS_DOWN, `draft-${rating}`, () => {
    b.disabled = true;
    void callbacks.onRate(rating).catch(() => (b.disabled = false));
  });
  b.setAttribute('aria-label', rating === 'up' ? 'Good reply' : 'Bad reply');
  return b;
}

function editor(text: string, callbacks: DraftCallbacks, close: () => void): HTMLElement {
  const box = document.createElement('div');
  const area = document.createElement('textarea');
  area.value = text;
  area.maxLength = 1000;
  area.rows = 4;
  area.dataset.testid = 'draft-editor';
  const problem = element('div', '', 'needs-edit');
  const save = button('Save', 'draft-save', () => {
    void callbacks.onEdit(area.value).then((error) => (error ? (problem.textContent = error) : close()));
  });
  box.append(area, problem, save, button('Cancel', 'draft-cancel', close));
  return box;
}

export function renderDraftActions(
  text: string,
  callbacks: DraftCallbacks,
  onEditing: (editing: boolean) => void = NOOP,
): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'draft-actions';
  const showButtons = () => {
    onEditing(false);
    bar.replaceChildren(
      copyButton(text, callbacks.onCopy),
      button('Edit', 'draft-edit', showEditor),
      rateButton('up', callbacks),
      rateButton('down', callbacks),
    );
  };
  function showEditor(): void {
    onEditing(true);
    bar.replaceChildren(editor(text, callbacks, showButtons));
  }
  showButtons();
  return bar;
}
