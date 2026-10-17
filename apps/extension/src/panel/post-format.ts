const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const LOCALE = 'en-US';

function parseDate(iso: string | null): Date | null {
  const date = iso ? new Date(iso) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

/** X-style age: "now", "45s", "12m", "3h", then "Oct 12" (this year) or "Oct 12, 2025". */
export function formatRelativeTime(iso: string | null, now: number): string {
  const date = parseDate(iso);
  if (!date) return '';
  const age = now - date.getTime();
  if (age < 5 * SECOND) return 'now';
  if (age < MINUTE) return `${Math.floor(age / SECOND)}s`;
  if (age < HOUR) return `${Math.floor(age / MINUTE)}m`;
  if (age < DAY) return `${Math.floor(age / HOUR)}h`;
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(LOCALE, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

/** X-style full timestamp: "3:04 PM · Oct 17, 2026" in the local time zone. */
export function formatAbsoluteTime(iso: string | null): string {
  const date = parseDate(iso);
  if (!date) return '';
  const time = date.toLocaleTimeString(LOCALE, { hour: 'numeric', minute: '2-digit' });
  const day = date.toLocaleDateString(LOCALE, { month: 'short', day: 'numeric', year: 'numeric' });
  // ICU puts a narrow no-break space before AM/PM; keep plain spaces.
  return `${time} · ${day}`.replace(/\s/g, ' ');
}

/** Up to two letters for the avatar fallback: initials of the display name, else of the handle. */
export function initialsFor(name: string, handle: string): string {
  const words = name.match(/[\p{L}\p{N}]+/gu) ?? [];
  const letters = words.length ? words.slice(0, 2).map((w) => [...w][0]) : [...handle].slice(0, 1);
  return letters.join('').toUpperCase() || '?';
}
