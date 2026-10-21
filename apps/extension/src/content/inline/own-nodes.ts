/** Tag of the one pill node we add to an X article (in its action bar); everything we render lives in its shadow root. */
export const HOST_TAG = 'xc-draft';
/** Tag of the one Ideas pill node we add to a compose toolbar. */
export const COMPOSE_TAG = 'xc-compose';

export const isOwnNode = (node: Node): boolean =>
  node instanceof Element && (node.localName === HOST_TAG || node.localName === COMPOSE_TAG);

/**
 * True when a mutation only inserted our own host. Those must not wake the observers (that would loop),
 * but a removal of our host must, so it gets re-attached.
 */
export function isOwnInsertion(record: MutationRecord): boolean {
  const added = Array.from(record.addedNodes);
  return record.removedNodes.length === 0 && added.length > 0 && added.every(isOwnNode);
}

const ownHosts = (article: Element): HTMLElement[] => Array.from(article.querySelectorAll<HTMLElement>(HOST_TAG));

/** Our live host in this article; a copy without a shadow root (a cloned article) does not count. */
export function findHost(article: Element): HTMLElement | null {
  return ownHosts(article).find((host) => host.shadowRoot) ?? null;
}

export function removeStaleHosts(article: Element, keep: Element | null): void {
  for (const host of ownHosts(article)) if (host !== keep) host.remove();
}

// Events from our nodes must never reach X's handlers (an article click opens the post, keys are shortcuts).
const ISOLATED_EVENTS = [
  'click', 'dblclick', 'auxclick', 'contextmenu', 'mousedown', 'mouseup', 'pointerdown', 'pointerup',
  'touchstart', 'touchend', 'keydown', 'keyup', 'keypress',
];

export function isolate(host: HTMLElement): void {
  for (const type of ISOLATED_EVENTS) host.addEventListener(type, (event) => event.stopPropagation());
}
