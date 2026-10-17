import { describe, expect, it } from 'vitest';
import { createToken, devTokenFromEnv, isAuthorized } from './auth';

const token = createToken();

describe('isAuthorized', () => {
  it('accepts the exact bearer token', () => {
    expect(isAuthorized(`Bearer ${token}`, token)).toBe(true);
  });

  it('rejects missing, malformed, wrong-length and wrong tokens', () => {
    expect(isAuthorized(undefined, token)).toBe(false);
    expect(isAuthorized('', token)).toBe(false);
    expect(isAuthorized(token, token)).toBe(false);
    expect(isAuthorized('Basic abc', token)).toBe(false);
    expect(isAuthorized('Bearer ', token)).toBe(false);
    expect(isAuthorized(`Bearer ${token}x`, token)).toBe(false);
    expect(isAuthorized(`Bearer ${token.slice(1)}`, token)).toBe(false);
    expect(isAuthorized(`Bearer ${'A'.repeat(token.length)}`, token)).toBe(false);
    expect(isAuthorized(`bearer ${token}`, token)).toBe(false);
  });
});

describe('createToken', () => {
  it('is unique and 256 bits', () => {
    expect(createToken()).not.toBe(createToken());
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
  });
});

describe('devTokenFromEnv', () => {
  it('requires a long enough url-safe token', () => {
    expect(devTokenFromEnv({})).toBeNull();
    expect(devTokenFromEnv({ XC_DEV_TOKEN: 'short' })).toBeNull();
    expect(devTokenFromEnv({ XC_DEV_TOKEN: 'has space in it 123456' })).toBeNull();
    expect(devTokenFromEnv({ XC_DEV_TOKEN: 'dev-token-1234567890' })).toBe('dev-token-1234567890');
  });
});
