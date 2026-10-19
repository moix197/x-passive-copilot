const PACIFIC = 'America/Los_Angeles';
const DAY_MS = 86_400_000;
const DEFAULT_SHORT_COOLDOWN_SEC = 60;

const pacificParts = new Intl.DateTimeFormat('en-US', {
  timeZone: PACIFIC,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
});

function pacificWallClockAsUtc(instant: number): number {
  const parts = Object.fromEntries(pacificParts.formatToParts(instant).map((p) => [p.type, Number(p.value)]));
  return Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!);
}

/** Pacific UTC offset (ms, negative) in force at `instant`; follows DST. */
function pacificOffsetMs(instant: number): number {
  return pacificWallClockAsUtc(Math.floor(instant / 1000) * 1000) - Math.floor(instant / 1000) * 1000;
}

/** Gemini free-tier daily quotas reset at midnight Pacific time. */
export function nextPacificMidnight(now: number): number {
  const wall = pacificWallClockAsUtc(now);
  const wallMidnight = Math.floor(wall / DAY_MS) * DAY_MS + DAY_MS;
  const guess = wallMidnight - pacificOffsetMs(now);
  // DST switches at 02:00, never at midnight, so one correction with the offset at the guess is exact.
  return wallMidnight - pacificOffsetMs(guess);
}

/** "Please retry in 48.2s" / "retryDelay":"48s" / "retry after 30 seconds" in provider error text. */
export function retryAfterSec(message: string): number | null {
  const match = /retry(?:Delay"?\s*:\s*"?| in | after )\s*(\d+(?:\.\d+)?)\s*s/i.exec(message);
  return match ? Math.ceil(Number(match[1])) : null;
}

const DAILY = /per.?day|daily/i;

/**
 * When a model that hit its quota may be tried again. A per-minute limit says "retry in N s"; a
 * second quota error right after such a short cooldown (no success in between), or one with no
 * hint at all, means the daily quota is gone.
 */
export function quotaResetAt(message: string, now: number, afterShortCooldown: boolean): { until: number; daily: boolean } {
  const wait = retryAfterSec(message);
  const daily = DAILY.test(message) || afterShortCooldown || (wait === null && /quota/i.test(message));
  if (daily) return { until: nextPacificMidnight(now), daily: true };
  return { until: now + (wait ?? DEFAULT_SHORT_COOLDOWN_SEC) * 1000, daily: false };
}

/** First model whose quota is not exhausted at `now`, in configured order. */
export function pickModel(models: readonly string[], exhaustedUntil: (model: string) => number, now: number): string | null {
  return models.find((model) => exhaustedUntil(model) <= now) ?? null;
}

/** Earliest instant any of `models` becomes usable again (0 when one is usable now). */
export function earliestReset(models: readonly string[], exhaustedUntil: (model: string) => number, now: number): number {
  if (models.length === 0) return 0;
  const soonest = Math.min(...models.map(exhaustedUntil));
  return soonest <= now ? 0 : soonest;
}
