import { isolate } from './own-nodes';

/** The open card lives in its own body-level host: X's overflow:hidden and transformed rows cannot clip or offset it. */
export const POPOVER_TAG = 'xc-draft-pop';

const WIDTH = 360;
const MAX_HEIGHT = 420;
const MARGIN = 8;
const GAP = 6;

interface Box {
  left: number;
  top: number;
  bottom: number;
}
export interface Placement {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

/** Below the anchor when it fits (or there is more room than above), else above; clamped to the viewport. */
export function placePopover(anchor: Box, contentHeight: number, view: { width: number; height: number }): Placement {
  const width = Math.min(WIDTH, view.width - 2 * MARGIN);
  const left = Math.max(MARGIN, Math.min(anchor.left, view.width - width - MARGIN));
  const below = view.height - anchor.bottom - GAP - MARGIN;
  const above = anchor.top - GAP - MARGIN;
  const wanted = Math.min(contentHeight, MAX_HEIGHT);
  const placeBelow = wanted <= below || below >= above;
  const maxHeight = Math.max(0, Math.min(MAX_HEIGHT, placeBelow ? below : above));
  const top = placeBelow ? anchor.bottom + GAP : anchor.top - GAP - Math.min(wanted, maxHeight);
  return { left, top, width, maxHeight };
}

interface Active {
  statusId: string;
  anchor: HTMLElement;
  card: HTMLElement;
  host: HTMLElement;
  stop: () => void;
}

let active: Active | null = null;

const setExpanded = (anchor: HTMLElement, open: boolean): void => anchor.setAttribute('aria-expanded', String(open));

function position(a: Active): void {
  const rect = a.anchor.getBoundingClientRect();
  if (!a.anchor.isConnected || (rect.width === 0 && rect.height === 0)) return closePopover();
  a.host.style.maxHeight = `${MAX_HEIGHT}px`;
  const p = placePopover(rect, a.host.scrollHeight, { width: window.innerWidth, height: window.innerHeight });
  Object.assign(a.host.style, { left: `${p.left}px`, top: `${p.top}px`, width: `${p.width}px`, maxHeight: `${p.maxHeight}px` });
}

// Closing on scroll is more robust than following: X virtualizes its timeline, so the anchor can unmount mid-scroll.
function listen(a: Active): () => void {
  const path = (event: Event) => event.composedPath();
  const onOutside = (event: Event) => {
    if (!path(event).includes(a.host) && !path(event).includes(a.anchor)) closePopover();
  };
  const onKey = (event: KeyboardEvent) => event.key === 'Escape' && closePopover();
  const onScroll = (event: Event) => path(event).includes(a.host) || closePopover();
  const onResize = () => position(a);
  const observer = new ResizeObserver(onResize);
  observer.observe(a.card);
  document.addEventListener('mousedown', onOutside, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('scroll', onScroll, { capture: true, passive: true });
  window.addEventListener('resize', onResize);
  return () => {
    observer.disconnect();
    document.removeEventListener('mousedown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', onResize);
  };
}

function createPopoverHost(card: HTMLElement, css: string): HTMLElement {
  const host = document.createElement(POPOVER_TAG);
  isolate(host);
  const style = document.createElement('style');
  style.textContent = css;
  host.attachShadow({ mode: 'open' }).append(style, card);
  return host;
}

export function closePopover(): void {
  if (!active) return;
  const a = active;
  active = null;
  a.stop();
  a.host.remove();
  setExpanded(a.anchor, false);
}

export const isPopoverOpenFor = (anchor: HTMLElement): boolean => active?.anchor === anchor;

export function openPopover(statusId: string, anchor: HTMLElement, card: HTMLElement, css: string): void {
  closePopover();
  const host = createPopoverHost(card, css);
  const a: Active = { statusId, anchor, card, host, stop: () => {} };
  active = a;
  document.body.append(host);
  a.stop = listen(a);
  setExpanded(anchor, true);
  position(a);
}

export const openCardFor = (statusId: string): HTMLElement | null =>
  active?.statusId === statusId ? active.card : null;

/** X re-rendered the article: the new pill takes over the open popover, whose card is reused. */
export function adoptOpenCard(statusId: string, anchor: HTMLElement): void {
  if (active?.statusId !== statusId) return;
  active.anchor = anchor;
  setExpanded(anchor, true);
}

/** Closes a popover whose pill is gone for good (the post is no longer flagged, or X dropped the article). */
export function closeDetachedPopover(): void {
  if (active && !active.anchor.isConnected) closePopover();
}
