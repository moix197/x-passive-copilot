import type { DatabaseSync } from 'node:sqlite';

export function localDayKey(now: number): string {
  const d = new Date(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `autoPolish:${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function usedToday(db: DatabaseSync, now: number): number {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(localDayKey(now)) as
    | { value: number }
    | undefined;
  return row?.value ?? 0;
}

export function remainingSlots(db: DatabaseSync, cap: number, now: number): number {
  return Math.max(0, cap - usedToday(db, now));
}

// Reserves one auto-polish slot for the local day; false when the cap is reached or disabled (0).
export function reserveSlot(db: DatabaseSync, cap: number, now: number): boolean {
  if (remainingSlots(db, cap, now) === 0) return false;
  db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, 1)
     ON CONFLICT(key) DO UPDATE SET value = value + 1`,
  ).run(localDayKey(now));
  return true;
}

export function releaseSlot(db: DatabaseSync, now: number): void {
  db.prepare('UPDATE meta SET value = MAX(0, value - 1) WHERE key = ?').run(localDayKey(now));
}
