import type { CapturedPost } from '@xc/shared/types';
import { parseMetrics } from './parse-metrics';
import { SEL } from './selectors';

const STATUS_PATH = /^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/;

function ownMatch(article: Element, selector: string): Element | null {
  const own = Array.from(article.querySelectorAll(selector)).find((el) => {
    const quote = el.closest(SEL.quoted);
    return !quote || !article.contains(quote);
  });
  return own ?? null;
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
  const quote = article.querySelector(SEL.quoted);
  return readStatusPath(quote?.querySelector(SEL.statusLink))?.statusId ?? null;
}

export function parseArticle(article: Element): CapturedPost | null {
  if (article.querySelector(SEL.promoted)) return null;
  const link = readStatusPath(ownMatch(article, SEL.time)?.closest('a'));
  if (!link) return null;
  const label = ownMatch(article, SEL.metrics)?.getAttribute('aria-label') ?? '';
  return {
    statusId: link.statusId,
    authorName: readAuthorName(article),
    authorHandle: link.handle,
    text: readText(article),
    postedAt: ownMatch(article, SEL.time)?.getAttribute('datetime')?.slice(0, 40) ?? null,
    metrics: parseMetrics(label),
    isReply: ownMatch(article, SEL.replyContext) !== null,
    quotedStatusId: readQuotedStatusId(article),
  };
}
