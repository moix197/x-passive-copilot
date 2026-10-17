export const SEL = {
  primaryColumn: '[data-testid="primaryColumn"]',
  article: 'article[data-testid="tweet"]',
  quoteCandidate: 'div[role="link"]',
  userName: '[data-testid="User-Name"]',
  tweetText: '[data-testid="tweetText"]',
  time: 'time',
  metrics: '[role="group"][aria-label]',
  statusLink: 'a[href*="/status/"]',
  replyCandidate: 'div, span',
} as const;

export const REPLY_PREFIX = /^(replying to|en respuesta a)\b/i;
