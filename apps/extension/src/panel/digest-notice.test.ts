import { describe, expect, it } from 'vitest';
import type { DigestView } from '@xc/shared/types';
import { generateErrorText, refreshFailedText } from './digest-notice';

const SUCCESS = new Date(2026, 9, 19, 9, 5).getTime();
const RESUME = new Date(2026, 9, 20, 0, 0).getTime();
const view = (failure: DigestView['failure'], withDigest = true): DigestView => ({
  digest: withDigest ? { createdAt: SUCCESS, trends: [], ideas: [] } : null,
  failed: true,
  failure,
  running: false,
  progress: null,
});

describe('refreshFailedText', () => {
  it('says the free quota ran out, when it resumes and when the last digest succeeded', () => {
    expect(refreshFailedText(view({ kind: 'paused', at: SUCCESS + 1, resumesAt: RESUME }))).toBe(
      'Last refresh failed: Gemini free quota reached on every configured model, resumes at 12:00 AM · Oct 20, 2026. ' +
        'Showing the previous digest from 9:05 AM · Oct 19, 2026.',
    );
  });

  it('tells a busy model apart and says it retries', () => {
    expect(refreshFailedText(view({ kind: 'busy', at: SUCCESS + 1, resumesAt: null }, false))).toBe(
      'Last refresh failed: Gemini is busy right now, it retries on the next refresh. No digest has succeeded yet.',
    );
  });

  it('falls back to a generic line when the cause was not recorded', () => {
    expect(refreshFailedText(view(null))).toBe('Last refresh failed. Showing the previous digest from 9:05 AM · Oct 19, 2026.');
  });
});

describe('generateErrorText', () => {
  it('adds the retry wait or the resume time', () => {
    expect(generateErrorText('Please wait', 12)).toBe('Please wait (try again in 12s)');
    expect(generateErrorText('Quota', undefined, RESUME)).toBe('Quota (resumes at 12:00 AM · Oct 20, 2026)');
    expect(generateErrorText('Boom')).toBe('Boom');
  });
});
