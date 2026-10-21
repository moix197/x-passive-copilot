import { AVATAR_URL_PATTERN, type CapturedPost } from '@xc/shared/types';
import { parseMetrics } from './parse-metrics';
import { MAX_REPLY_TO, REPLY_CONTEXT_MAX_CHARS, REPLY_HANDLE, REPLY_PREFIX, SEL } from './selectors';

const STATUS_PATH = /^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/;

function findQuotes(article: Element): Element[] {
  return Array.from(article.querySelectorAll(SEL.quoteCandidate)).filter(
    (el) => el.querySelector(SEL.userName) && el.querySelector(SEL.time),
  );
}

function ownElements(article: Element, selector: string): Element[] {
  const quotes = findQuotes(article);
  return Array.from(article.querySelectorAll(selector)).filter(
    (el) => !quotes.some((quote) => quote.contains(el)),
  );
}

function ownMatch(article: Element, selector: string): Element | null {
  return ownElements(article, selector)[0] ?? null;
}

export function readStatusPath(anchor: Element | null | undefined): { handle: string; statusId: string } | null {
  const href = anchor?.getAttribute('href');
  if (!href) return null;
  const match = STATUS_PATH.exec(new URL(href, 'https://x.com').pathname);
  return match?.[1] && match[2] ? { handle: match[1], statusId: match[2] } : null;
}

function readAuthorName(article: Element): string {
  const name = ownMatch(article, SEL.userName)?.querySelector(SEL.userNameLink)?.textContent ?? '';
  return name.trim().slice(0, 200);
}

// Read-only: the attribute X already rendered; anything off X's image CDN is dropped, not sent.
function readAvatarUrl(article: Element): string | null {
  const src = ownMatch(article, SEL.avatarImage)?.getAttribute('src') ?? '';
  return AVATAR_URL_PATTERN.test(src) ? src : null;
}

function readText(article: Element): string {
  return (ownMatch(article, SEL.tweetText)?.textContent ?? '').trim().slice(0, 4000);
}

function readQuotedStatusId(article: Element): string | null {
  const quote = findQuotes(article)[0];
  return readStatusPath(quote?.querySelector(SEL.statusLink))?.statusId ?? null;
}

function isOutsideTweetText(el: Element): boolean {
  return !el.closest(SEL.tweetText) && !el.querySelector(SEL.tweetText);
}

function readReplyContext(article: Element): string | null {
  for (const el of ownElements(article, SEL.replyCandidate)) {
    const text = (el.textContent ?? '').trim();
    if (text.length <= REPLY_CONTEXT_MAX_CHARS && REPLY_PREFIX.test(text) && isOutsideTweetText(el)) return text;
  }
  return null;
}

function readReplyTargets(context: string): string[] {
  const handles = Array.from(context.matchAll(REPLY_HANDLE), (m) => m[1] ?? '');
  return [...new Set(handles)].slice(0, MAX_REPLY_TO);
}

function readOwnStatus(article: Element): { time: Element; link: { handle: string; statusId: string } } | null {
  const time = ownMatch(article, SEL.time);
  const link = readStatusPath(time?.closest('a'));
  return time && link ? { time, link } : null;
}

/** The outer post's status id, without parsing the rest of the article. */
export function readArticleStatusId(article: Element): string | null {
  return readOwnStatus(article)?.link.statusId ?? null;
}

export function parseArticle(article: Element): CapturedPost | null {
  const status = readOwnStatus(article);
  if (!status) return null;
  const { time, link } = status;
  const label = ownMatch(article, SEL.metrics)?.getAttribute('aria-label') ?? '';
  const replyContext = readReplyContext(article);
  return {
    statusId: link.statusId,
    authorName: readAuthorName(article),
    authorHandle: link.handle,
    text: readText(article),
    postedAt: time.getAttribute('datetime')?.slice(0, 40) ?? null,
    metrics: parseMetrics(label),
    isReply: replyContext !== null,
    replyTo: replyContext ? readReplyTargets(replyContext) : [],
    quotedStatusId: readQuotedStatusId(article),
    avatarUrl: readAvatarUrl(article),
  };
}
