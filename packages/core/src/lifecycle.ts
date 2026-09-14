import {
  CHECKIN_CLOSES_AFTER_MS,
  CHECKIN_OPENS_BEFORE_MS,
} from './constants';

/**
 * FR-19 — three clocks, not one. Location is the most sensitive and least
 * durable data in the product; the feed outlives it; the event record outlives
 * both. Derived in one place so the API, the purge job and any admin tool
 * cannot disagree about when something should be gone.
 */
export const LOCATION_RETENTION_AFTER_START_MS = 6 * 60 * 60_000;
export const LOCATION_RETENTION_AFTER_ARRIVAL_MS = 3 * 60 * 60_000;
export const FEED_RETENTION_MS = 30 * 24 * 60 * 60_000;
export const EVENT_RETENTION_MS = 7 * 24 * 60 * 60_000;

export interface RetentionSchedule {
  locationPurgeAt: number;
  feedPurgeAt: number;
  expiresAt: number;
}

export function retentionSchedule(startsAt: number): RetentionSchedule {
  return {
    locationPurgeAt: startsAt + LOCATION_RETENTION_AFTER_START_MS,
    feedPurgeAt: startsAt + FEED_RETENTION_MS,
    expiresAt: startsAt + EVENT_RETENTION_MS,
  };
}

/**
 * FR-19 — once the last person is in, location data has no reason to live for
 * another five hours. Brings the purge forward, never pushes it back.
 */
export function locationPurgeAfterArrival(
  currentPurgeAt: number,
  lastArrivalAt: number,
): number {
  return Math.min(
    currentPurgeAt,
    lastArrivalAt + LOCATION_RETENTION_AFTER_ARRIVAL_MS,
  );
}

/** FR-9 — the window in which "I'm on my way" is the primary action. */
export function isCheckinOpen(startsAt: number, now: number): boolean {
  return (
    now >= startsAt - CHECKIN_OPENS_BEFORE_MS &&
    now <= startsAt + CHECKIN_CLOSES_AFTER_MS
  );
}
