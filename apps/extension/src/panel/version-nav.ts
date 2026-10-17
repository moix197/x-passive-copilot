import type { DraftVersion } from '@xc/shared/types';
import { element } from './dom';

function navButton(label: string, ariaLabel: string, testId: string, target: DraftVersion | undefined, onSelect: (v: DraftVersion) => void) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'version-step';
  b.textContent = label;
  b.dataset.testid = testId;
  b.setAttribute('aria-label', ariaLabel);
  b.disabled = !target;
  b.addEventListener('click', () => {
    if (target) onSelect(target);
  });
  return b;
}

/** "‹ 2/3 ›" pager over a draft's versions; null when there is nothing to flip between. */
export function renderVersionNav(
  versions: DraftVersion[],
  selectedId: number | null,
  onSelect: (version: DraftVersion) => void,
): HTMLElement | null {
  if (versions.length < 2) return null;
  const found = versions.findIndex((v) => v.id === selectedId);
  const index = found === -1 ? versions.length - 1 : found;
  const nav = document.createElement('div');
  nav.className = 'version-nav';
  nav.setAttribute('role', 'group');
  nav.setAttribute('aria-label', 'Reply versions');
  const label = element('span', `${index + 1}/${versions.length}`, 'version-label');
  label.dataset.testid = 'version-label';
  nav.append(
    navButton('‹', 'Previous version', 'version-prev', versions[index - 1], onSelect),
    label,
    navButton('›', 'Next version', 'version-next', versions[index + 1], onSelect),
  );
  return nav;
}
