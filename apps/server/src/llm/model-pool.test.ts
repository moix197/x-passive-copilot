import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig, err, ok, type Result } from '@xc/shared';
import { openDb } from '../db';
import { createModelPool, modelChain } from './model-pool';

const QUOTA = 'opencode error: APIError: You exceeded your current quota, please check your plan and billing details.';
const PER_MINUTE = 'opencode error: APIError: Resource exhausted. Please retry in 5s.';
const GONE = 'opencode error: APIError: models/gemini-2.5-flash is no longer available to new users.';
const NOW = Date.parse('2026-10-19T17:00:00Z');
const MIDNIGHT = Date.parse('2026-10-20T07:00:00Z');

function scripted(answers: Record<string, string[]>) {
  const calls: string[] = [];
  const run = async (_prompt: string, model: string): Promise<Result<string>> => {
    calls.push(model);
    const next = answers[model]?.shift() ?? 'ok';
    return next === 'ok' ? ok(`reply from ${model}`) : err(next);
  };
  return { calls, run };
}

const freshHome = () => mkdtempSync(join(tmpdir(), 'xc-pool-'));

describe('modelChain', () => {
  it('puts models.triage first, then fallbacks, deduplicated; empty when triage is off', () => {
    const config = defaultConfig();
    expect(modelChain({ ...config, models: { ...config.models, triage: 'a', triageFallbacks: ['b', 'a', 'c'] } })).toEqual(['a', 'b', 'c']);
    expect(modelChain({ ...config, models: { ...config.models, triage: '', triageFallbacks: ['b'] } })).toEqual([]);
  });
});

describe('createModelPool', () => {
  it('falls back on a quota error without retrying, and remembers the exhausted model across restarts', async () => {
    const home = freshHome();
    const script = scripted({ a: [QUOTA] });
    const pool = createModelPool(openDb(home), ['a', 'b'], script.run, () => NOW);
    expect(await pool.run('p')).toEqual(ok('reply from b'));
    expect(script.calls).toEqual(['a', 'b']);

    const restarted = createModelPool(openDb(home), ['a', 'b'], script.run, () => NOW + 60_000);
    expect(await restarted.run('p')).toEqual(ok('reply from b'));
    expect(script.calls).toEqual(['a', 'b', 'b']);
    expect(restarted.status()).toEqual({ active: 'b', exhausted: [{ model: 'a', until: MIDNIGHT, unavailable: false }], pausedUntil: 0 });
  });

  it('pauses with a paused error until the earliest reset once every model is exhausted, then resumes', async () => {
    let now = NOW;
    const script = scripted({ a: [QUOTA], b: [PER_MINUTE] });
    const pool = createModelPool(openDb(freshHome()), ['a', 'b'], script.run, () => now);
    const paused = await pool.run('p');
    expect(paused.ok ? '' : paused.error).toMatch(/^paused: /);
    expect(pool.pausedUntil()).toBe(NOW + 5000);
    expect(await pool.run('p')).toEqual(paused);
    expect(script.calls).toEqual(['a', 'b']);

    now = NOW + 5000;
    expect(await pool.run('p')).toEqual(ok('reply from b'));
    expect(pool.status().pausedUntil).toBe(0);
  });

  it('treats a repeat quota error right after a short cooldown as the daily quota', async () => {
    let now = NOW;
    const script = scripted({ a: [PER_MINUTE, PER_MINUTE] });
    const pool = createModelPool(openDb(freshHome()), ['a'], script.run, () => now);
    await pool.run('p');
    now = NOW + 5000;
    await pool.run('p');
    expect(pool.pausedUntil()).toBe(MIDNIGHT);
  });

  it('skips a retired model and reports it, and passes other errors straight through', async () => {
    const script = scripted({ a: [GONE], b: ['opencode error: APIError: This model is currently experiencing high demand.'] });
    const pool = createModelPool(openDb(freshHome()), ['a', 'b'], script.run, () => NOW);
    const out = await pool.run('p');
    expect(out.ok ? '' : out.error).toMatch(/high demand/);
    expect(pool.status().exhausted).toEqual([{ model: 'a', until: NOW + 30 * 86_400_000, unavailable: true }]);
  });
});
