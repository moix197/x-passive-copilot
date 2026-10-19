const EM_DASH = '—';
const EN_DASH = '–';
// Horizontal whitespace only: a dash next to a line break must never swallow the break.
const SPACE = String.raw`[^\S\r\n]`;
const DASH = `[${EM_DASH}${EN_DASH}]`;

const NUMBER_RANGE = new RegExp(String.raw`(\d)${SPACE}*${DASH}${SPACE}*(\d)`, 'g');
const LINE_EDGE = new RegExp(String.raw`${SPACE}*${DASH}+${SPACE}*(?=\r?\n)|(?<=\n)${SPACE}*${DASH}+${SPACE}*`, 'g');
const SPACED_OR_EM = new RegExp(`${SPACE}*(?:${EM_DASH}|${SPACE}${EN_DASH}|${EN_DASH}${SPACE})+${SPACE}*`, 'g');
const BARE_EN = new RegExp(EN_DASH, 'g');
const DOUBLED_PUNCTUATION = new RegExp(`([,.!?;:])${SPACE}*,${SPACE}*`, 'g');
const EDGE_COMMA = /^\s*,\s*|\s*,\s*$/g;

/** Models love the em dash; replaces it (and en dashes used as dashes) with a comma, hyphen or nothing at a line edge. */
export function replaceDashes(text: string): string {
  return text
    .replace(NUMBER_RANGE, '$1-$2')
    .replace(LINE_EDGE, '')
    .replace(SPACED_OR_EM, ', ')
    .replace(BARE_EN, '-')
    .replace(DOUBLED_PUNCTUATION, '$1 ')
    .replace(EDGE_COMMA, '');
}
