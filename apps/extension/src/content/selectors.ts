export const SEL = {
  primaryColumn: '[data-testid="primaryColumn"]',
  article: 'article[data-testid="tweet"]',
  quoteCandidate: 'div[role="link"]',
  userName: '[data-testid="User-Name"]',
  userNameLink: 'a',
  // Live DOM unverified: the outer author's avatar; quoted posts use other containers and ownMatch drops them anyway.
  avatarImage: '[data-testid="Tweet-User-Avatar"] img',
  tweetText: '[data-testid="tweetText"]',
  time: 'time',
  metrics: '[role="group"][aria-label]',
  // Live DOM unverified: the reply/repost/like/views row; the last group in the article is the outer post's.
  actionBar: '[role="group"]',
  statusLink: 'a[href*="/status/"]',
  replyCandidate: 'div, span',
} as const;

// Live DOM unverified: X renders "Replying to @a and @b" outside tweetText (ES: "En respuesta a").
export const REPLY_PREFIX = /^(replying to|en respuesta a)\b/i;
export const REPLY_CONTEXT_MAX_CHARS = 300;
export const REPLY_HANDLE = /@([A-Za-z0-9_]{1,15})(?![A-Za-z0-9_])/g;
export const MAX_REPLY_TO = 10;
