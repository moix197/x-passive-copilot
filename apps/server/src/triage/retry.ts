import { err, type Result } from '@xc/shared';

const ATTEMPTS = 3;
const BASE_DELAY_MS = 2000;
const RATE_LIMIT_DELAY_MS = 60_000;

export const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

export function isRateLimited(message: string): boolean {
  return /rate.?limit|\b429\b|quota|too many requests/i.test(message);
}

export function retryDelayMs(message: string, attempt: number): number {
  return isRateLimited(message) ? RATE_LIMIT_DELAY_MS : BASE_DELAY_MS * 2 ** attempt;
}

export async function withRetry<T>(
  run: () => Promise<Result<T>>,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<Result<T>> {
  let last: Result<T> = err('no attempt made');
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    last = await run();
    if (last.ok) return last;
    if (attempt < ATTEMPTS - 1) await wait(retryDelayMs(last.error, attempt));
  }
  return last;
}

export function errorClass(message: string): string {
  if (message.startsWith('timeout')) return 'timeout';
  if (isRateLimited(message)) return 'rate limit';
  if (message.startsWith('malformed')) return 'malformed output';
  return 'cli failed';
}
