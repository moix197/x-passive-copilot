import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb } from '../db';
import { localDayKey, releaseSlot, remainingSlots, reserveSlot } from './daily-cap';

const freshDb = () => openDb(mkdtempSync(join(tmpdir(), 'xc-cap-')));
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();

describe('localDayKey', () => {
  it('uses the local calendar day', () => {
    expect(localDayKey(at(2026, 10, 17, 0))).toBe('autoPolish:2026-10-17');
    expect(localDayKey(new Date(2026, 9, 17, 23, 59).getTime())).toBe('autoPolish:2026-10-17');
    expect(localDayKey(at(2026, 10, 18, 0))).not.toBe(localDayKey(at(2026, 10, 17, 23)));
  });
});

describe('slots', () => {
  it('reserves up to the cap and resets on a new day', () => {
    const db = freshDb();
    const now = at(2026, 10, 17);
    expect([reserveSlot(db, 2, now), reserveSlot(db, 2, now), reserveSlot(db, 2, now)]).toEqual([true, true, false]);
    expect(remainingSlots(db, 2, now)).toBe(0);
    expect(remainingSlots(db, 2, at(2026, 10, 18))).toBe(2);
  });

  it('never reports negative remaining, even if the cap shrinks', () => {
    const db = freshDb();
    const now = at(2026, 10, 17);
    reserveSlot(db, 5, now);
    reserveSlot(db, 5, now);
    expect(remainingSlots(db, 1, now)).toBe(0);
  });

  it('cap 0 disables reservation', () => {
    const db = freshDb();
    expect(reserveSlot(db, 0, at(2026, 10, 17))).toBe(false);
  });

  it('release returns a slot and never goes below zero', () => {
    const db = freshDb();
    const now = at(2026, 10, 17);
    reserveSlot(db, 1, now);
    releaseSlot(db, now);
    releaseSlot(db, now);
    expect(remainingSlots(db, 1, now)).toBe(1);
  });
});
