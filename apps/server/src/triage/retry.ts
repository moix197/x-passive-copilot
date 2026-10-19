import { err, type ModelFailureKind, type Result } from '@xc/shared';

const ATTEMPTS = 3;
const BASE_DELAY_MS = 2000;
const BUSY_DELAY_MS = 10_000;
/** Our own marker when every configured model is out of quota (see llm/model-pool.ts). */
export const PAUSED_PREFIX = 'paused';

export const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

const QUOTA = /exceeded your current quota|resource.?exhausted|\bquota\b/i;
const RATE = /rate.?limit|\b429\b|too many requests/i;
const BUSY = /high demand|overloaded|\b503\b|service unavailable|unavailable: /i;
const UNAVAILABLE = /no longer available|is not found for API version|model[^.]{0,80}not (?:found|supported)/i;

export function classifyFailure(message: string): ModelFailureKind {
  if (message.startsWith(PAUSED_PREFIX)) return 'paused';
  if (message.startsWith('timeout')) return 'timeout';
  if (UNAVAILABLE.test(message)) return 'unavailable';
  if (QUOTA.test(message)) return 'quota';
  if (RATE.test(message)) return 'rate';
  if (BUSY.test(message)) return 'busy';
  if (message.startsWith('malformed')) return 'malformed';
  return 'cli';
}

/** Never retried: quota/rate errors (a retry spends more of the same quota) and retired models. */
export function isFinalFailure(kind: ModelFailureKind): boolean {
  return kind === 'quota' || kind === 'rate' || kind === 'paused' || kind === 'unavailable';
}

export function retryDelayMs(kind: ModelFailureKind, attempt: number): number {
  return (kind === 'busy' ? BUSY_DELAY_MS : BASE_DELAY_MS) * 2 ** attempt;
}

export async function withRetry<T>(
  run: () => Promise<Result<T>>,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<Result<T>> {
  let last: Result<T> = err('no attempt made');
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    last = await run();
    if (last.ok) return last;
    const kind = classifyFailure(last.error);
    if (isFinalFailure(kind)) return last;
    if (attempt < ATTEMPTS - 1) await wait(retryDelayMs(kind, attempt));
  }
  return last;
}

const CONTROL_CHARS = /\u001b\[[0-9;]*m|[\u0000-\u001f\u007f]+/g;

/** Log-safe failure detail: CLI/provider error text only (callers never put prompts in errors). */
export function safeReason(message: string): string {
  return message.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

const ERROR_CLASS: Record<ModelFailureKind, string> = {
  timeout: 'timeout',
  quota: 'rate limit',
  rate: 'rate limit',
  paused: 'rate limit',
  busy: 'model busy',
  unavailable: 'model unavailable',
  malformed: 'malformed output',
  cli: 'cli failed',
};

export function errorClass(message: string): string {
  return ERROR_CLASS[classifyFailure(message)];
}
