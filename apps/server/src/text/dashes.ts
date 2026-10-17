const EM_DASH = '—';
const EN_DASH = '–';

const NUMBER_RANGE = new RegExp(`(\\d)\\s*${EN_DASH}\\s*(\\d)`, 'g');
const SPACED_OR_EM = new RegExp(`\\s*(?:${EM_DASH}|\\s${EN_DASH}|${EN_DASH}\\s)+\\s*`, 'g');
const BARE_EN = new RegExp(EN_DASH, 'g');
const DOUBLED_PUNCTUATION = /([,.!?;:])\s*,\s*/g;
const EDGE_COMMA = /^\s*,\s*|\s*,\s*$/g;

/** Models love the em dash; replaces it (and en dashes used as dashes) with a comma or hyphen. */
export function replaceDashes(text: string): string {
  return text
    .replace(NUMBER_RANGE, '$1-$2')
    .replace(SPACED_OR_EM, ', ')
    .replace(BARE_EN, '-')
    .replace(DOUBLED_PUNCTUATION, '$1 ')
    .replace(EDGE_COMMA, '');
}
