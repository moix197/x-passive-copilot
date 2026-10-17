export const SEL = {
  primaryColumn: '[data-testid="primaryColumn"]',
  article: 'article[data-testid="tweet"]',
  promoted: '[data-testid="placementTracking"]',
  quoted: '[data-testid="quoteTweet"]',
  replyContext: '[data-testid="replyContext"]',
  userName: '[data-testid="User-Name"]',
  tweetText: '[data-testid="tweetText"]',
  time: 'time',
  metrics: '[role="group"][aria-label]',
  statusLink: 'a[href*="/status/"]',
} as const;
