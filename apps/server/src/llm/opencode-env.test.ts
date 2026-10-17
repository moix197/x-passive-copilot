import { describe, expect, it } from 'vitest';
import { claudeEnv } from './claude';
import { hasGeminiKey, opencodeEnv, redactKey } from './opencode-env';
import { childEnv } from './run-cli';

describe('opencodeEnv', () => {
  it('maps GEMINI_API_KEY to the google provider var and drops the original', () => {
    const env = opencodeEnv({ GEMINI_API_KEY: ' k1 ', PATH: '/bin' });
    expect(env).toEqual({ GOOGLE_GENERATIVE_AI_API_KEY: 'k1', PATH: '/bin' });
  });

  it('adds nothing for a missing or blank key', () => {
    expect(opencodeEnv({ GEMINI_API_KEY: ' ', PATH: '/bin' })).toEqual({ PATH: '/bin' });
    expect(hasGeminiKey({ GEMINI_API_KEY: '' })).toBe(false);
    expect(hasGeminiKey({ GEMINI_API_KEY: 'k' })).toBe(true);
  });

  it('keeps the key away from claude and generic children', () => {
    expect(childEnv({ GEMINI_API_KEY: 'k', PATH: '/bin' })).toEqual({ PATH: '/bin' });
    expect(claudeEnv({ GOOGLE_GENERATIVE_AI_API_KEY: 'k', PATH: '/bin' })).toEqual({ PATH: '/bin' });
  });

  it('redacts the key from failure text', () => {
    expect(redactKey('bad key abc123 here', { GEMINI_API_KEY: 'abc123' })).toBe('bad key [redacted] here');
  });
});
