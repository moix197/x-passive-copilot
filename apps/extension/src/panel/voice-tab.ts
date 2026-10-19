import { MAX_STYLE_NOTES, StyleNotesSchema, VoiceViewSchema, type VoiceView } from '@xc/shared/types';
import { element } from './dom';
import { pollWhileVisible } from './posts-view';

export function mountPolled<T>(
  root: HTMLElement,
  load: () => Promise<T>,
  render: (data: T) => HTMLElement[],
  shouldSkip: () => boolean = () => false,
  intervalMs?: () => number,
): () => void {
  const status = element('p', 'Loading...', 'status');
  const body = document.createElement('div');
  root.replaceChildren(status, body);
  return pollWhileVisible(async () => {
    try {
      const data = await load();
      if (!shouldSkip()) body.replaceChildren(...render(data));
      status.textContent = '';
    } catch {
      status.textContent = 'Server offline.';
    }
  }, intervalMs);
}

function list(items: string[], className: string): HTMLElement {
  const ul = document.createElement('ul');
  ul.className = className;
  for (const item of items) ul.append(element('li', item));
  return ul;
}

function profileSection(view: VoiceView): HTMLElement[] {
  const p = view.profile;
  if (!p) {
    const note = view.failed
      ? 'Profile generation failed; it will retry.'
      : 'No profile yet. Browse your own X profile so your posts are captured.';
    return [element('p', note, 'status')];
  }
  return [
    element('p', `Tone: ${p.tone}`),
    element('p', `Length: ${p.length}`),
    element('p', `Vocabulary: ${p.vocabulary}`),
    element('h3', 'Do', 'voice-sub'),
    list(p.dos, 'voice-list'),
    element('h3', "Don't", 'voice-sub'),
    list(p.donts, 'voice-list'),
  ];
}

export function renderVoice(view: VoiceView): HTMLElement[] {
  const wrap = document.createElement('section');
  wrap.className = 'voice';
  wrap.dataset.testid = 'voice-tab';
  const plural = view.sampleCount === 1 ? '' : 's';
  const count = `${view.sampleCount} own post${plural} captured (profile starts at ${view.minSamples})`;
  wrap.append(element('h2', 'Voice profile', 'voice-title'), element('p', count, 'post-tags'), ...profileSection(view));
  wrap.append(element('h3', 'Good examples', 'voice-sub'), list(view.examples.positive, 'voice-list'));
  wrap.append(element('h3', 'Avoid examples', 'voice-sub'), list(view.examples.negative, 'voice-list'));
  return [wrap];
}

export interface StyleNotesApi {
  load: () => Promise<unknown>;
  save: (notes: string) => Promise<unknown>;
}

function mountStyleNotes(root: HTMLElement, api: StyleNotesApi): void {
  const wrap = document.createElement('section');
  wrap.className = 'style-notes';
  wrap.dataset.testid = 'style-notes';
  const label = element('label', 'Style notes') as HTMLLabelElement;
  label.className = 'voice-sub';
  label.htmlFor = 'style-notes-input';
  const input = document.createElement('textarea');
  input.id = 'style-notes-input';
  input.maxLength = MAX_STYLE_NOTES;
  input.rows = 5;
  input.placeholder = 'Your writing rules, e.g. keep it short, lowercase ok';
  input.disabled = true;
  input.dataset.testid = 'style-notes-input';
  const save = document.createElement('button');
  save.type = 'button';
  save.textContent = 'Save';
  save.disabled = true;
  save.dataset.testid = 'style-notes-save';
  const state = element('span', 'Loading...');
  state.dataset.testid = 'style-notes-state';
  const setState = (text: string) => (state.textContent = text);
  const row = document.createElement('div');
  row.className = 'style-notes-row';
  row.append(save, state);
  wrap.append(label, input, row);
  root.append(wrap);

  api.load().then(
    (raw) => {
      input.value = StyleNotesSchema.parse(raw).notes;
      input.disabled = save.disabled = false;
      setState('');
    },
    () => setState('Could not load style notes.'),
  );
  save.addEventListener('click', () => {
    save.disabled = true;
    setState('Saving...');
    api.save(input.value).then(
      (raw) => {
        input.value = StyleNotesSchema.parse(raw).notes;
        setState('Saved');
      },
      () => setState('Save failed.'),
    ).finally(() => (save.disabled = false));
  });
}

export function mountVoiceTab(root: HTMLElement, load: () => Promise<unknown>, notes: StyleNotesApi): () => void {
  const polled = document.createElement('div');
  root.replaceChildren();
  mountStyleNotes(root, notes);
  root.append(polled);
  return mountPolled(polled, async () => VoiceViewSchema.parse(await load()), renderVoice);
}
