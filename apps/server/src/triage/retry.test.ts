import { describe, expect, it } from 'vitest';
import { err, ok, type Result } from '@xc/shared';
import { classifyFailure, errorClass, retryDelayMs, safeReason, withRetry } from './retry';

describe('safeReason', () => {
  it('flattens ANSI, control chars and whitespace and caps at 200 chars', () => {
    expect(safeReason('exit 1: \u001b[93m! \u001b[0mpermission\r\n  denied\t')).toBe('exit 1: ! permission denied');
    expect(safeReason('x'.repeat(500))).toHaveLength(200);
  });

  it('keeps the coarse class separate from the detail', () => {
    expect(errorClass('opencode error: APIError: FreeTierError')).toBe('cli failed');
    expect(errorClass('timeout')).toBe('timeout');
    expect(errorClass('opencode error: APIError: This model is currently experiencing high demand.')).toBe('model busy');
  });
});

describe('classifyFailure', () => {
  it.each([
    ['opencode error: APIError: You exceeded your current quota, please check your plan and billing details.', 'quota'],
    ['opencode error: APIError: RESOURCE_EXHAUSTED', 'quota'],
    ['opencode error: APIError: 429 Too Many Requests', 'rate'],
    ['opencode error: APIError: Rate limit reached', 'rate'],
    ['opencode error: APIError: This model is currently experiencing high demand. Please try again later.', 'busy'],
    ['opencode error: APIError: The model is overloaded.', 'busy'],
    ['opencode error: APIError: models/gemini-2.5-flash is no longer available to new users.', 'unavailable'],
    ['paused: quota reached on every model until 2026-10-20T07:00:00.000Z', 'paused'],
    ['timeout', 'timeout'],
    ['malformed output: no JSON array', 'malformed'],
    ['exit 1: boom', 'cli'],
  ])('%s -> %s', (message, kind) => {
    expect(classifyFailure(message)).toBe(kind);
  });
});

describe('withRetry', () => {
  async function attempts(errors: string[]): Promise<{ calls: number; waits: number[] }> {
    let calls = 0;
    const waits: number[] = [];
    const run = async (): Promise<Result<string>> => {
      const e = errors[calls++];
      return e ? err(e) : ok('done');
    };
    await withRetry(run, async (ms) => void waits.push(ms));
    return { calls, waits };
  }

  it('never retries quota, rate-limit, paused or retired-model errors', async () => {
    for (const e of ['You exceeded your current quota', '429 Too Many Requests', 'paused: x', 'is no longer available to new users']) {
      expect(await attempts([e, e, e])).toEqual({ calls: 1, waits: [] });
    }
  });

  it('retries a busy model with a longer backoff, other failures with the short one', async () => {
    expect(await attempts(['high demand', 'high demand', 'high demand'])).toEqual({ calls: 3, waits: [10_000, 20_000] });
    expect(await attempts(['exit 1', 'exit 1'])).toEqual({ calls: 3, waits: [2000, 4000] });
    expect(retryDelayMs('cli', 0)).toBe(2000);
  });
});
