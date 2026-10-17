export const SEL = {
  primaryColumn: '[data-testid="primaryColumn"]',
  article: 'article[data-testid="tweet"]',
  quoteCandidate: 'div[role="link"]',
  userName: '[data-testid="User-Name"]',
  userNameLink: 'a',
  tweetText: '[data-testid="tweetText"]',
  time: 'time',
  metrics: '[role="group"][aria-label]',
  statusLink: 'a[href*="/status/"]',
  replyCandidate: 'div, span',
} as const;

// Live DOM unverified: X renders "Replying to @a and @b" outside tweetText (ES: "En respuesta a").
export const REPLY_PREFIX = /^(replying to|en respuesta a)\b/i;
export const REPLY_CONTEXT_MAX_CHARS = 300;
export const REPLY_HANDLE = /@([A-Za-z0-9_]{1,15})(?![A-Za-z0-9_])/g;
export const MAX_REPLY_TO = 10;
