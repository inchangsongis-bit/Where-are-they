import { describe, expect, it } from 'vitest';
import {
  EVENT_RETENTION_MS,
  FEED_RETENTION_MS,
  isCheckinOpen,
  locationPurgeAfterArrival,
  retentionSchedule,
} from './lifecycle';

const HOUR = 60 * 60_000;
const START = Date.UTC(2026, 8, 10, 23, 30, 0);

describe('retentionSchedule', () => {
  it('gives location the shortest life of the three', () => {
    const s = retentionSchedule(START);
    expect(s.locationPurgeAt).toBeLessThan(s.feedPurgeAt);
    expect(s.feedPurgeAt).toBeGreaterThan(s.expiresAt);
    expect(s.locationPurgeAt).toBe(START + 6 * HOUR);
  });

  it('keeps the event record for a week and the feed for a month', () => {
    const s = retentionSchedule(START);
    expect(s.expiresAt).toBe(START + EVENT_RETENTION_MS);
    expect(s.feedPurgeAt).toBe(START + FEED_RETENTION_MS);
  });
});

describe('locationPurgeAfterArrival', () => {
  it('brings the purge forward once everyone is in', () => {
    const scheduled = START + 6 * HOUR;
    const lastArrival = START + 30 * 60_000;
    expect(locationPurgeAfterArrival(scheduled, lastArrival)).toBe(
      lastArrival + 3 * HOUR,
    );
  });

  it('never pushes the purge later than already scheduled', () => {
    const scheduled = START + 1 * HOUR;
    const lateArrival = START + 5 * HOUR;
    expect(locationPurgeAfterArrival(scheduled, lateArrival)).toBe(scheduled);
  });
});

describe('isCheckinOpen', () => {
  it.each([
    ['three hours before', START - 3 * HOUR, false],
    ['two hours before', START - 2 * HOUR, true],
    ['at the start', START, true],
    ['three hours after', START + 3 * HOUR, true],
    ['four hours after', START + 4 * HOUR, false],
  ])('is %s -> %s', (_label, now, expected) => {
    expect(isCheckinOpen(START, now as number)).toBe(expected);
  });
});
