export const MAX_REPLY_LENGTH = 280;
const URL_LENGTH = 23;

export interface Violation {
  rule: string;
  detail: string;
}

// Bare domains need a known TLD so code names like Node.js are not taken for links.
// TLDs that double as file extensions or words (.sh, .so, .in, .cc, ...) are left out so install.sh is not a link.
const BARE_TLDS =
  'com|net|org|io|co|app|dev|xyz|ai|gg|fun|lol|tv|us|uk|ly|fm|de|es|fr|info|biz|site|' +
  'online|tech|link|page|eu|ca|pro|club|live|news|blog|shop|store|finance|money|exchange|network|wtf|vip';
const URL_PATTERN = new RegExp(
  String.raw`https?://[^\s]+|(?<![\w@./-])(?:[a-z0-9-]+\.)+(?:${BARE_TLDS})(?![\w-])(?:/[^\s]*)?`,
  'gi',
);
const MENTION_PATTERN = /(?<![\w@])@(\w{1,15})/g;
const HASHTAG_PATTERN = /(?<![\w#])#\w+/g;
const HYPE_PATTERN = /\b(moon(?:ing)?|gems?|buy(?:ing)?|alpha|[0-9]+x|pump(?:ing)?|lambo|wagmi|lfg)\b/gi;
const PRICE_PATTERNS = [
  /\bprice (?:target|prediction)\b/i,
  /\bwill (?:hit|reach|go to|be worth|pump|dump) \$?\d/i,
  /\b(?:going|headed|heading) to \$?\d/i,
  /\bto the moon\b/i,
];
const ADVICE_PATTERN =
  /\b(?:you should|you must|i recommend|financial advice|nfa|dyor|go long|go short|(?:should|must) (?:buy|sell))\b/gi;

function trimTrailingPunctuation(url: string): string {
  return url.replace(/[.,;:!?)\]"']+$/, '');
}

function urlsIn(text: string): string[] {
  return (text.match(URL_PATTERN) ?? []).map(trimTrailingPunctuation);
}

function urlKey(url: string): string {
  return url.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
}

function mentionsIn(text: string): string[] {
  return [...text.matchAll(MENTION_PATTERN)].map((m) => (m[1] ?? '').toLowerCase());
}

export function replyLength(text: string): number {
  const withoutUrls = text.replace(URL_PATTERN, (url) => url.slice(trimTrailingPunctuation(url).length));
  return [...withoutUrls].length + urlsIn(text).length * URL_LENGTH;
}

function tooLong(text: string): Violation[] {
  const length = replyLength(text);
  return length > MAX_REPLY_LENGTH ? [{ rule: 'too-long', detail: `${length} chars` }] : [];
}

function hashtagCount(text: string): Violation[] {
  const count = (text.match(HASHTAG_PATTERN) ?? []).length;
  return count > 1 ? [{ rule: 'hashtags', detail: `${count} hashtags` }] : [];
}

function matches(rule: string, pattern: RegExp, text: string): Violation[] {
  return [...text.matchAll(pattern)].map((m) => ({ rule, detail: m[0].toLowerCase() }));
}

function pricePredictions(text: string): Violation[] {
  const hit = PRICE_PATTERNS.find((p) => p.test(text));
  return hit ? [{ rule: 'price-prediction', detail: hit.exec(text)?.[0] ?? '' }] : [];
}

function foreignUrls(text: string, source: string): Violation[] {
  const allowed = new Set(urlsIn(source).map(urlKey));
  return urlsIn(text)
    .filter((u) => !allowed.has(urlKey(u)))
    .map((u) => ({ rule: 'foreign-url', detail: u }));
}

function foreignMentions(text: string, source: string): Violation[] {
  const allowed = new Set(mentionsIn(source));
  return mentionsIn(text)
    .filter((m) => !allowed.has(m))
    .map((m) => ({ rule: 'foreign-mention', detail: `@${m}` }));
}

export function checkReply(text: string, source: string): Violation[] {
  return [
    ...tooLong(text),
    ...hashtagCount(text),
    ...matches('hype-word', HYPE_PATTERN, text),
    ...pricePredictions(text),
    ...matches('advice', ADVICE_PATTERN, text),
    ...foreignUrls(text, source),
    ...foreignMentions(text, source),
  ];
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A reply naming the product when the post does not is almost always a pitch; flagged, not blocked. */
export function productMention(text: string, source: string, product: string): Violation[] {
  const pattern = new RegExp(`(?<![\\w])${escapeRegExp(product)}(?![\\w])`, 'i');
  return pattern.test(text) && !pattern.test(source) ? [{ rule: 'product-mention', detail: product }] : [];
}

export function ruleNames(violations: Violation[]): string[] {
  return [...new Set(violations.map((v) => v.rule))];
}
