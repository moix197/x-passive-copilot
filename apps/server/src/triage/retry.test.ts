import { describe, expect, it } from 'vitest';
import { errorClass, safeReason } from './retry';

describe('safeReason', () => {
  it('flattens ANSI, control chars and whitespace and caps at 200 chars', () => {
    expect(safeReason('exit 1: \u001b[93m! \u001b[0mpermission\r\n  denied\t')).toBe('exit 1: ! permission denied');
    expect(safeReason('x'.repeat(500))).toHaveLength(200);
  });

  it('keeps the coarse class separate from the detail', () => {
    expect(errorClass('opencode error: APIError: FreeTierError')).toBe('cli failed');
    expect(errorClass('timeout')).toBe('timeout');
  });
});
