/** Tag of the one node we add to an X article; everything we render lives in its shadow root. */
export const HOST_TAG = 'xc-draft';

export const isOwnNode = (node: Node): boolean => node instanceof Element && node.localName === HOST_TAG;

/**
 * True when a mutation only inserted our own host. Those must not wake the observers (that would loop),
 * but a removal of our host must, so it gets re-attached.
 */
export function isOwnInsertion(record: MutationRecord): boolean {
  const added = Array.from(record.addedNodes);
  return record.removedNodes.length === 0 && added.length > 0 && added.every(isOwnNode);
}

/** Our live host in this article; a copy without a shadow root (a cloned article) does not count. */
export function findHost(article: Element): HTMLElement | null {
  for (const child of Array.from(article.children)) {
    if (isOwnNode(child) && child.shadowRoot) return child as HTMLElement;
  }
  return null;
}

export function removeStaleHosts(article: Element, keep: Element | null): void {
  for (const child of Array.from(article.children)) {
    if (isOwnNode(child) && child !== keep) child.remove();
  }
}
