import type { DigestIdea, IdeaKind, IdeaSource } from '@xc/shared/types';
import { element } from './dom';

export const IDEA_KIND_LABELS: Record<IdeaKind, string> = {
  spacehub: 'Spacehub',
  eco: 'Eco',
  inspired: 'From timeline',
  quote: 'Quote',
};

function kindTag(kind: IdeaKind): HTMLElement {
  const tag = element('span', IDEA_KIND_LABELS[kind], 'idea-kind');
  tag.dataset.testid = 'idea-kind';
  tag.dataset.kind = kind;
  return tag;
}

// Only opens the post: for a quote idea the user clicks Quote on X themselves.
function openPostLink(url: string): HTMLAnchorElement {
  const link = document.createElement('a');
  link.textContent = 'Open post';
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.dataset.testid = 'idea-source-link';
  return link;
}

function sourceLine(source: IdeaSource): HTMLElement {
  const line = element('div', '', 'idea-source');
  line.dataset.testid = 'idea-source';
  const quote = element('span', `@${source.authorHandle}: ${source.excerpt}`, 'idea-source-text');
  quote.title = source.excerpt;
  line.append(quote, ...(source.url ? [openPostLink(source.url)] : []));
  return line;
}

/** The idea's kind tag and feature, plus the source post line for inspired and quote ideas. */
export function ideaMeta(idea: DigestIdea): HTMLElement[] {
  const tags = element('div', '', 'post-tags idea-tags');
  tags.append(kindTag(idea.kind), document.createTextNode(idea.feature));
  return idea.source ? [tags, sourceLine(idea.source)] : [tags];
}
