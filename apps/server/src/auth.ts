import { randomBytes, timingSafeEqual } from 'node:crypto';

const BEARER = /^Bearer ([A-Za-z0-9_-]+)$/;
const DEV_TOKEN = /^[A-Za-z0-9_-]{16,128}$/;

export function createToken(): string {
  return randomBytes(32).toString('base64url');
}

export function isAuthorized(header: string | undefined, token: string): boolean {
  const given = Buffer.from(BEARER.exec(header ?? '')?.[1] ?? '');
  const wanted = Buffer.from(token);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

export function devTokenFromEnv(env: NodeJS.ProcessEnv): string | null {
  const value = env.XC_DEV_TOKEN;
  return value && DEV_TOKEN.test(value) ? value : null;
}
