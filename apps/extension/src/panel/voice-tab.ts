import { VoiceViewSchema, type VoiceView } from '@xc/shared/types';
import { element } from './posts-view';

const POLL_MS = 3000;

export function mountPolled<T>(
  root: HTMLElement,
  load: () => Promise<T>,
  render: (data: T) => HTMLElement[],
  shouldSkip: () => boolean = () => false,
): () => void {
  const status = element('p', 'Loading...', 'status');
  const body = document.createElement('div');
  root.replaceChildren(status, body);
  let busy = false;
  const refresh = async () => {
    if (busy || document.visibilityState !== 'visible') return;
    busy = true;
    try {
      const data = await load();
      if (!shouldSkip()) body.replaceChildren(...render(data));
      status.textContent = '';
    } catch {
      status.textContent = 'Server offline.';
    } finally {
      busy = false;
    }
  };
  const onVisibility = () => void refresh();
  document.addEventListener('visibilitychange', onVisibility);
  const timer = setInterval(() => void refresh(), POLL_MS);
  void refresh();
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisibility);
  };
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

export function mountVoiceTab(root: HTMLElement, load: () => Promise<unknown>): () => void {
  return mountPolled(root, async () => VoiceViewSchema.parse(await load()), renderVoice);
}
