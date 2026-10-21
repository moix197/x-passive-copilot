import { MAX_IDEA_SOURCE_TEXT, type IdeaSourceInput } from '@xc/shared/types';
import { parseArticle, readStatusPath } from './parse-article';
import { SEL } from './selectors';

const HANDLE = /^@([A-Za-z0-9_]{1,15})$/;

const clipText = (text: string): string => text.trim().slice(0, MAX_IDEA_SOURCE_TEXT);

// The author line holds name, @handle and time in separate spans; the handle is the span reading "@handle".
function readQuotedHandle(card: Element, linkHandle: string | undefined): string | null {
  const spans = Array.from(card.querySelector(SEL.userName)?.querySelectorAll('span') ?? []);
  const shown = spans.map((span) => HANDLE.exec((span.textContent ?? '').trim())?.[1]).find(Boolean);
  return shown ?? linkHandle ?? null;
}

/**
 * The post embedded in X's Quote composer that holds this toolbar, read-only: author, text and the status id
 * when the card links it. Null in any other composer.
 */
export function readQuotedPost(toolbar: Element): IdeaSourceInput | null {
  const card = toolbar.closest(SEL.quoteComposer)?.querySelector(SEL.quotedCard);
  if (!card) return null;
  const link = readStatusPath(card.querySelector(SEL.statusLink));
  const authorHandle = readQuotedHandle(card, link?.handle);
  const text = clipText(card.querySelector(SEL.tweetText)?.textContent ?? '');
  return authorHandle && text ? { statusId: link?.statusId ?? null, authorHandle, text } : null;
}

/** A timeline post as the source of a manual idea; null when the article has no text. */
export function readArticleSource(article: Element): IdeaSourceInput | null {
  const post = parseArticle(article);
  const text = clipText(post?.text ?? '');
  return post && text ? { statusId: post.statusId, authorHandle: post.authorHandle, text } : null;
}
