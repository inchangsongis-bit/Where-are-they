import { describe, expect, it } from 'vitest';
import { evaluateArrival, hasDwelledLongEnough, nextDwellStart } from './arrival';
import { ARRIVAL_DWELL_MS } from './constants';

const VENUE = { lat: 40.7188, lng: -73.9938 };
const AT_DOOR = { lat: 40.71885, lng: -73.99385 };
const DOWN_THE_STREET = { lat: 40.7238, lng: -73.9938 };
const NOW = Date.UTC(2026, 8, 10, 23, 30, 0);

describe('nextDwellStart', () => {
  it('starts the clock on the first fix inside the radius', () => {
    expect(nextDwellStart(null, AT_DOOR, VENUE, NOW)).toBe(NOW);
  });

  it('keeps the original start while they stay inside', () => {
    const started = NOW - 30_000;
    expect(nextDwellStart(started, AT_DOOR, VENUE, NOW)).toBe(started);
  });

  it('resets when they leave the radius', () => {
    expect(nextDwellStart(NOW - 30_000, DOWN_THE_STREET, VENUE, NOW)).toBeNull();
  });

  it('stays null while they are still outside', () => {
    expect(nextDwellStart(null, DOWN_THE_STREET, VENUE, NOW)).toBeNull();
  });
});

describe('hasDwelledLongEnough', () => {
  it('is false with no dwell at all', () => {
    expect(hasDwelledLongEnough(null, NOW)).toBe(false);
  });

  it('is false for a single fix that just landed inside', () => {
    expect(hasDwelledLongEnough(NOW, NOW)).toBe(false);
  });

  it('is false just short of the dwell time', () => {
    expect(hasDwelledLongEnough(NOW - ARRIVAL_DWELL_MS + 1, NOW)).toBe(false);
  });

  it('is true once the dwell time has passed', () => {
    expect(hasDwelledLongEnough(NOW - ARRIVAL_DWELL_MS, NOW)).toBe(true);
  });
});

describe('evaluateArrival', () => {
  it('does not arrive on proximity alone — GPS drifts and people walk past', () => {
    const result = evaluateArrival({
      insideSince: null, position: AT_DOOR, venue: VENUE, now: NOW,
    });
    expect(result.insideSince).toBe(NOW);
    expect(result.arrived).toBe(false);
  });

  it('arrives after a continuous minute inside', () => {
    const result = evaluateArrival({
      insideSince: NOW - 61_000, position: AT_DOOR, venue: VENUE, now: NOW,
    });
    expect(result.arrived).toBe(true);
  });

  it('does not arrive for someone who drove past the door', () => {
    // Inside for 40s, then gone: the clock resets rather than accumulating.
    const passing = evaluateArrival({
      insideSince: NOW - 40_000, position: DOWN_THE_STREET, venue: VENUE, now: NOW,
    });
    expect(passing.insideSince).toBeNull();
    expect(passing.arrived).toBe(false);

    // Coming back later starts from scratch.
    const returning = evaluateArrival({
      insideSince: passing.insideSince, position: AT_DOOR, venue: VENUE,
      now: NOW + 120_000,
    });
    expect(returning.arrived).toBe(false);
  });
});
