import { describe, expect, it } from 'vitest';
import { defaultConfig, err, ok } from '@xc/shared';
import { checkQuota, clockTime, createDoctor } from './doctor';

describe('checkQuota', () => {
  const until = new Date(2026, 9, 20, 0, 0).getTime();

  it('is silent while every model has quota', () => {
    expect(checkQuota({ active: 'a', exhausted: [], pausedUntil: 0 })).toBeNull();
  });

  it('names the exhausted model and the fallback in use', () => {
    const c = checkQuota({ active: 'b', exhausted: [{ model: 'a', until, unavailable: false }], pausedUntil: 0 });
    expect(c).toMatchObject({ status: 'ok', detail: 'Gemini quota reached for a until 00:00, using b' });
  });

  it('says when triage and digest resume once every model is exhausted, and flags retired models', () => {
    const exhausted = [
      { model: 'a', until, unavailable: false },
      { model: 'b', until: until + 1, unavailable: true },
    ];
    const c = checkQuota({ active: null, exhausted, pausedUntil: until });
    expect(c?.status).toBe('problem');
    expect(c?.detail).toBe(`Gemini quota reached for a until 00:00; b is no longer available; triage and digest paused until ${clockTime(until)}`);
    expect(c?.fix).toMatch(/models.triageFallbacks/);
  });
});

describe('doctor', () => {
  it('reports missing, ok and not-logged-in CLIs and caches for 60s', async () => {
    let calls = 0;
    let now = 0;
    const doctor = createDoctor({
      home: '/nonexistent-home',
      config: defaultConfig(),
      now: () => now,
      resolve: (name) => (name === 'opencode' ? err('not found') : ok(['claude'])),
      run: async (argv) => {
        calls++;
        return argv.includes('status') ? ok({ stdout: '{"loggedIn":false,"email":"a@b.c"}', stderr: '' }) : ok({ stdout: '2.0.1 (Claude Code)\n', stderr: '' });
      },
    });
    const report = await doctor();
    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    expect(byId.opencode?.status).toBe('missing');
    expect(byId.claude).toMatchObject({ status: 'not_logged_in', detail: '2.0.1 (Claude Code)' });
    expect(JSON.stringify(report)).not.toContain('a@b.c');
    expect(byId.handle?.status).toBe('problem');
    expect(byId.context?.status).toBe('missing');
    expect(byId.announcements?.status).toBe('missing');
    const before = calls;
    now = 59_000;
    await doctor();
    expect(calls).toBe(before);
    now = 61_000;
    await doctor();
    expect(calls).toBeGreaterThan(before);
  });

  it('opencode without credentials is ok only for a free opencode/*-free triage model', async () => {
    const opencodeStatus = async (triage: string) => {
      const config = { ...defaultConfig(), models: { ...defaultConfig().models, triage } };
      const doctor = createDoctor({
        home: '/nonexistent-home',
        config,
        resolve: () => ok(['opencode']),
        run: async (argv) => ok({ stdout: argv.includes('auth') ? 'Credentials\n0 credentials\n' : '1.19.3\n', stderr: '' }),
      });
      return (await doctor()).checks.find((c) => c.id === 'opencode');
    };
    expect(await opencodeStatus('opencode/deepseek-v4.1-flash-free')).toMatchObject({ status: 'ok', fix: null });
    expect(await opencodeStatus('anthropic/claude-x')).toMatchObject({ status: 'not_logged_in' });
  });
});

describe('doctor with a google triage model', () => {
  const geminiStatus = async (env: NodeJS.ProcessEnv) => {
    const config = { ...defaultConfig(), models: { ...defaultConfig().models, triage: 'google/gemini-3.8-flash' } };
    const doctor = createDoctor({
      home: '/nonexistent-home',
      config,
      env,
      resolve: () => ok(['opencode']),
      run: async (argv) => ok({ stdout: argv.includes('auth') ? 'Credentials\n0 credentials\n' : '1.19.3\n', stderr: '' }),
    });
    return (await doctor()).checks.find((c) => c.id === 'opencode');
  };

  it('is ok with GEMINI_API_KEY set and points at .env otherwise', async () => {
    expect(await geminiStatus({ GEMINI_API_KEY: 'k' })).toMatchObject({ status: 'ok', fix: null });
    const missing = await geminiStatus({});
    expect(missing?.status).toBe('not_logged_in');
    expect(missing?.fix).toMatch(/Add GEMINI_API_KEY to .*\.env \(free key at aistudio\.google\.com\)/);
  });
});
