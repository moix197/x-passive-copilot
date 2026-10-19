import { describeModelFailure, type DigestView } from '@xc/shared/types';
import { formatAbsoluteTime } from './post-format';

const at = (ms: number) => formatAbsoluteTime(new Date(ms).toISOString());

function causeText(failure: NonNullable<DigestView['failure']>): string {
  const resumes = failure.resumesAt ? `, resumes at ${at(failure.resumesAt)}` : '';
  const retry = failure.kind === 'busy' ? ', it retries on the next refresh' : '';
  return `${describeModelFailure(failure.kind)}${resumes}${retry}`;
}

/** Banner for a failed refresh: why it failed in plain words and when a digest last succeeded. */
export function refreshFailedText(view: DigestView): string {
  const why = view.failure ? `Last refresh failed: ${causeText(view.failure)}.` : 'Last refresh failed.';
  const last = view.digest ? ` Showing the previous digest from ${at(view.digest.createdAt)}.` : ' No digest has succeeded yet.';
  return why + last;
}

/** Inline message for a refused or failed manual run, from the server's error body. */
export function generateErrorText(error: string, retryAfterSec?: number, resumesAt?: number): string {
  if (retryAfterSec !== undefined) return `${error} (try again in ${retryAfterSec}s)`;
  if (resumesAt !== undefined) return `${error} (resumes at ${at(resumesAt)})`;
  return error;
}
