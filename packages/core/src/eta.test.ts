import { describe, expect, it } from 'vitest';
import { ASSUMED_SPEED_MPS, DETOUR_FACTOR, straightLineEta } from './eta';
import { distanceM } from './geo';
import type { TravelMode } from './types';

const VENUE = { lat: 40.7188, lng: -73.9938 };
const NOW = Date.UTC(2026, 8, 10, 23, 30, 0);
const MODES: TravelMode[] = ['driving', 'walking', 'transit', 'cycling'];

describe('straightLineEta', () => {
  const from = { lat: 40.7338, lng: -73.9938 }; // ~1.7km due north

  it('labels itself as an estimate, never as a route', () => {
    expect(straightLineEta(from, VENUE, 'driving', NOW).source).toBe('straight_line');
  });

  it('reports a distance longer than the straight line, because roads bend', () => {
    const crow = distanceM(from, VENUE);
    const estimate = straightLineEta(from, VENUE, 'driving', NOW);
    expect(estimate.distanceM).toBeGreaterThan(crow);
    expect(estimate.distanceM).toBeCloseTo(crow * DETOUR_FACTOR.driving, -1);
  });

  it.each(MODES)('produces an ETA in the future for %s', (mode) => {
    expect(straightLineEta(from, VENUE, mode, NOW).etaAt).toBeGreaterThan(NOW);
  });

  it('takes longer on foot than by car over the same ground', () => {
    const driving = straightLineEta(from, VENUE, 'driving', NOW).durationS;
    const walking = straightLineEta(from, VENUE, 'walking', NOW).durationS;
    expect(walking).toBeGreaterThan(driving);
  });

  it('never says someone standing outside is already there', () => {
    const nextDoor = { lat: 40.71882, lng: -73.99382 };
    const estimate = straightLineEta(nextDoor, VENUE, 'walking', NOW);
    expect(estimate.durationS).toBeGreaterThanOrEqual(60);
    expect(estimate.etaAt).toBeGreaterThan(NOW);
  });

  it('is deliberately conservative: assumed speeds are urban, not top speed', () => {
    expect(ASSUMED_SPEED_MPS.driving).toBeLessThan(14); // under 50 km/h
    for (const mode of MODES) expect(DETOUR_FACTOR[mode]).toBeGreaterThan(1);
  });

  it('scales roughly linearly with distance', () => {
    const near = straightLineEta({ lat: 40.7238, lng: -73.9938 }, VENUE, 'driving', NOW);
    const far = straightLineEta({ lat: 40.7638, lng: -73.9938 }, VENUE, 'driving', NOW);
    expect(far.durationS / near.durationS).toBeGreaterThan(5);
  });
});
