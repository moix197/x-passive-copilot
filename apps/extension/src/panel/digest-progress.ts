import type { DigestProgress, DigestStep } from '@xc/shared/types';
import { element } from './dom';

const ICON: Record<DigestStep['state'], string> = { done: '✓', current: '', pending: '•', failed: '✕' };

export function elapsedText(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function outcomeText(outcome: NonNullable<DigestProgress['outcome']>): string {
  if (!outcome.ok) return `Failed: ${outcome.reason}`;
  return `Done — ${outcome.ideas} idea${outcome.ideas === 1 ? '' : 's'}`;
}

/** One step row (done, current spinner, pending, failed), shared by the digest and job progress boxes. */
export function renderStep(step: Pick<DigestStep, 'label' | 'state' | 'detail'>, testId = 'digest-step'): HTMLElement {
  const item = document.createElement('li');
  item.className = `digest-step ${step.state}`;
  item.dataset.testid = testId;
  item.dataset.state = step.state;
  const icon = element('span', ICON[step.state], 'digest-step-icon');
  icon.setAttribute('aria-hidden', 'true');
  const text = element('div', '', 'digest-step-text');
  const label = element('span', step.label, 'digest-step-label');
  label.dataset.testid = 'step-label';
  text.append(label);
  if (step.detail) {
    const detail = element('span', step.detail, 'digest-step-detail');
    detail.dataset.testid = 'step-detail';
    text.append(detail);
  }
  item.append(icon, text);
  return item;
}

function renderHead(progress: DigestProgress): HTMLElement {
  const head = element('div', '', 'digest-progress-head');
  const title = element('span', progress.outcome ? outcomeText(progress.outcome) : 'Generating ideas', 'digest-progress-title');
  title.dataset.testid = 'digest-progress-title';
  const elapsed = element('span', elapsedText(progress.elapsedMs), 'digest-progress-elapsed');
  elapsed.dataset.testid = 'digest-progress-elapsed';
  head.append(title, elapsed);
  return head;
}

/** Fills `box` with the run's steps; an empty, hidden box when no run is in progress or just finished. */
export function paintDigestProgress(box: HTMLElement, progress: DigestProgress | null): void {
  box.hidden = progress === null;
  if (!progress) return box.replaceChildren();
  box.className = `digest-progress${progress.outcome ? (progress.outcome.ok ? ' ok' : ' failed') : ''}`;
  const steps = document.createElement('ol');
  steps.className = 'digest-steps';
  steps.append(...progress.steps.map((step) => renderStep(step)));
  box.replaceChildren(renderHead(progress), steps);
}

export function digestProgressBox(): HTMLElement {
  const box = document.createElement('section');
  box.className = 'digest-progress';
  box.dataset.testid = 'digest-progress';
  box.setAttribute('aria-label', 'Digest progress');
  box.setAttribute('aria-live', 'polite');
  box.hidden = true;
  return box;
}
