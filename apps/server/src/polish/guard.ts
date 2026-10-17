export const MAX_REPLY_LENGTH = 280;
const URL_LENGTH = 23;

export interface Violation {
  rule: string;
  detail: string;
}

const URL_PATTERN = /https?:\/\/[^\s]+/gi;
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

function mentionsIn(text: string): string[] {
  return [...text.matchAll(MENTION_PATTERN)].map((m) => (m[1] ?? '').toLowerCase());
}

export function replyLength(text: string): number {
  const withoutUrls = text.replace(URL_PATTERN, '');
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
  const allowed = new Set(urlsIn(source).map((u) => u.toLowerCase()));
  return urlsIn(text)
    .filter((u) => !allowed.has(u.toLowerCase()))
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

export function ruleNames(violations: Violation[]): string[] {
  return [...new Set(violations.map((v) => v.rule))];
}
