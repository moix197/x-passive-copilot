import type { CapturedPost } from '@xc/shared/types';
import { parseMetrics } from './parse-metrics';
import { REPLY_PREFIX, SEL } from './selectors';

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

function readStatusPath(anchor: Element | null | undefined): { handle: string; statusId: string } | null {
  const href = anchor?.getAttribute('href');
  if (!href) return null;
  const match = STATUS_PATH.exec(new URL(href, 'https://x.com').pathname);
  return match?.[1] && match[2] ? { handle: match[1], statusId: match[2] } : null;
}

function readAuthorName(article: Element): string {
  const name = ownMatch(article, SEL.userName)?.querySelector('a')?.textContent ?? '';
  return name.trim().slice(0, 200);
}

function readText(article: Element): string {
  return (ownMatch(article, SEL.tweetText)?.textContent ?? '').trim().slice(0, 4000);
}

function readQuotedStatusId(article: Element): string | null {
  const quote = findQuotes(article)[0];
  return readStatusPath(quote?.querySelector(SEL.statusLink))?.statusId ?? null;
}

function isReply(article: Element): boolean {
  return ownElements(article, SEL.replyCandidate).some((el) => {
    const text = (el.textContent ?? '').trim();
    return text.length <= 80 && REPLY_PREFIX.test(text) && !el.closest(SEL.tweetText);
  });
}

export function parseArticle(article: Element): CapturedPost | null {
  const time = ownMatch(article, SEL.time);
  const link = readStatusPath(time?.closest('a'));
  if (!time || !link) return null;
  const label = ownMatch(article, SEL.metrics)?.getAttribute('aria-label') ?? '';
  return {
    statusId: link.statusId,
    authorName: readAuthorName(article),
    authorHandle: link.handle,
    text: readText(article),
    postedAt: time.getAttribute('datetime')?.slice(0, 40) ?? null,
    metrics: parseMetrics(label),
    isReply: isReply(article),
    quotedStatusId: readQuotedStatusId(article),
  };
}
