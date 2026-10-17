import { describe, expect, it } from 'vitest';
import { defaultConfig, err, ok } from '@xc/shared';
import { createDoctor } from './doctor';

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
    const before = calls;
    now = 59_000;
    await doctor();
    expect(calls).toBe(before);
    now = 61_000;
    await doctor();
    expect(calls).toBeGreaterThan(before);
  });
});
