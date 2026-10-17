import type { CaptureMessage, CapturedPost } from '@xc/shared/types';
import { parseArticle } from './parse-article';
import { SEL } from './selectors';

const DEBOUNCE_MS = 1000;
const MAX_BATCH = 50;

const seen = new Set<string>();
let timer: number | undefined;

function collectNewPosts(column: Element): CapturedPost[] {
  const fresh: CapturedPost[] = [];
  for (const article of Array.from(column.querySelectorAll(SEL.article))) {
    const post = parseArticle(article);
    if (post && !seen.has(post.statusId)) {
      seen.add(post.statusId);
      fresh.push(post);
    }
  }
  return fresh;
}

async function sendBatch(posts: CapturedPost[]): Promise<void> {
  const message: CaptureMessage = { type: 'posts', posts };
  try {
    const reply = await chrome.runtime.sendMessage(message);
    if (reply?.ok) return;
  } catch {
    // service worker unreachable: fall through and allow a retry
  }
  for (const post of posts) seen.delete(post.statusId);
}

function flush(): void {
  const column = document.querySelector(SEL.primaryColumn);
  if (!column) return;
  const fresh = collectNewPosts(column);
  for (let i = 0; i < fresh.length; i += MAX_BATCH) {
    void sendBatch(fresh.slice(i, i + MAX_BATCH));
  }
}

function schedule(): void {
  window.clearTimeout(timer);
  timer = window.setTimeout(flush, DEBOUNCE_MS);
}

function watch(): void {
  const columnObserver = new MutationObserver(schedule);
  let current: Element | null = null;
  const attach = () => {
    const column = document.querySelector(SEL.primaryColumn);
    if (!column || column === current) return;
    current = column;
    columnObserver.disconnect();
    columnObserver.observe(column, { childList: true, subtree: true });
    schedule();
  };
  new MutationObserver(attach).observe(document.body, { childList: true, subtree: true });
  attach();
}

watch();
