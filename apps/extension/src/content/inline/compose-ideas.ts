import { element } from '../../panel/dom';
import panelCss from '../../panel/panel.css';
import { readQuotedPost } from '../idea-source';
import { SEL } from '../selectors';
import { createIdeasCard, type IdeasCard } from './compose-card';
import inlineCss from './inline.css';
import { shadowHost, sparkleIcon } from './inline-card';
import { adoptDetachedCard, closePopover, isPopoverOpenFor, openPopover } from './inline-popover';
import { COMPOSE_TAG, isOwnInsertion } from './own-nodes';

/** Popover key of the Ideas card; every compose toolbar's pill opens the same card. */
const POPOVER_KEY = 'compose-ideas';

function ideasPill(ideas: IdeasCard, toolbar: Element): HTMLButtonElement {
  const pill = document.createElement('button');
  pill.type = 'button';
  pill.className = 'inline-badge';
  pill.dataset.testid = 'compose-ideas-pill';
  pill.title = 'Post ideas to copy into your post';
  pill.setAttribute('aria-expanded', 'false');
  pill.setAttribute('aria-haspopup', 'dialog');
  pill.append(sparkleIcon(), element('span', 'Ideas', 'pill-label'));
  pill.addEventListener('click', () => {
    if (isPopoverOpenFor(pill)) return closePopover();
    openPopover(POPOVER_KEY, pill, ideas.card, panelCss + inlineCss);
    ideas.refresh(readQuotedPost(toolbar));
  });
  return pill;
}

const mountPoint = (toolbar: Element): Element => toolbar.querySelector(SEL.composerTools) ?? toolbar;

const ownHosts = (mount: Element): Element[] => Array.from(mount.children).filter((c) => c.localName === COMPOSE_TAG);

// A host without a shadow root is a copy left by X cloning the toolbar: dropped, and a live pill added.
function ensurePill(toolbar: Element, ideas: IdeasCard): void {
  const mount = mountPoint(toolbar);
  const hosts = ownHosts(mount);
  for (const stale of hosts.filter((host) => !host.shadowRoot)) stale.remove();
  if (hosts.some((host) => host.shadowRoot)) return;
  const pill = ideasPill(ideas, toolbar);
  mount.append(shadowHost(COMPOSE_TAG, pill));
  adoptDetachedCard(POPOVER_KEY, pill);
}

function syncComposers(ideas: IdeasCard): void {
  for (const toolbar of Array.from(document.querySelectorAll(SEL.composerToolbar))) ensurePill(toolbar, ideas);
}

/**
 * An "Ideas" pill in every X compose toolbar (Post modal, home composer). It only adds our own node:
 * it never types into the compose box, clicks X's buttons or posts. The user copies an idea and pastes it.
 */
export function watchComposers(): void {
  const ideas = createIdeasCard();
  // Synchronous on each batch, so a re-rendered toolbar gets its pill (and the open popover) back at once.
  const observer = new MutationObserver((records) => {
    if (!records.every(isOwnInsertion)) syncComposers(ideas);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  syncComposers(ideas);
}
