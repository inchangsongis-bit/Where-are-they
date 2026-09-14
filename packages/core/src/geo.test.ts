import { describe, expect, it } from 'vitest';
import { distanceM, isAtVenue, roundPosition, trackingTier } from './geo';
import { ARRIVAL_RADIUS_M } from './constants';

const VENUE = { lat: 40.7188, lng: -73.9938 }; // Kisa Izakaya, 118 Bowery

describe('distanceM', () => {
  it('is zero for the same point', () => {
    expect(distanceM(VENUE, VENUE)).toBe(0);
  });

  it('matches a known city-scale distance', () => {
    // 118 Bowery -> Washington Square Park, ~1.5km on the ground.
    const wsp = { lat: 40.7308, lng: -73.9973 };
    expect(distanceM(VENUE, wsp)).toBeGreaterThan(1_300);
    expect(distanceM(VENUE, wsp)).toBeLessThan(1_700);
  });

  it('is symmetric', () => {
    const other = { lat: 40.7308, lng: -73.9973 };
    expect(distanceM(VENUE, other)).toBeCloseTo(distanceM(other, VENUE), 6);
  });

  it('handles the antimeridian without blowing up', () => {
    const west = { lat: 0, lng: 179.999 };
    const east = { lat: 0, lng: -179.999 };
    expect(distanceM(west, east)).toBeLessThan(300);
  });
});

describe('isAtVenue', () => {
  it('accepts a point just inside the geofence', () => {
    // ~0.0009 degrees of latitude is roughly 100m.
    expect(isAtVenue({ lat: VENUE.lat + 0.0009, lng: VENUE.lng }, VENUE)).toBe(true);
  });

  it('rejects a point outside it', () => {
    expect(isAtVenue({ lat: VENUE.lat + 0.005, lng: VENUE.lng }, VENUE)).toBe(false);
  });

  it('uses the radius from the requirements', () => {
    expect(ARRIVAL_RADIUS_M).toBe(150);
  });
});

describe('trackingTier', () => {
  it('reports arrived inside the geofence', () => {
    expect(trackingTier(VENUE, VENUE)).toBe('arrived');
  });

  it('reports approaching within 5km', () => {
    expect(trackingTier({ lat: 40.7308, lng: -73.9973 }, VENUE)).toBe('approaching');
  });

  it('reports far beyond 5km, where cheap coarse tracking is enough', () => {
    expect(trackingTier({ lat: 40.79, lng: -73.95 }, VENUE)).toBe('far');
  });
});

describe('roundPosition', () => {
  it('rounds to five decimals and keeps the other fields', () => {
    const rounded = roundPosition({
      lat: 40.71883456789,
      lng: -73.99381234567,
      accuracyM: 12,
      recordedAt: 1,
    });
    expect(rounded.lat).toBe(40.71883);
    expect(rounded.lng).toBe(-73.99381);
    expect(rounded.accuracyM).toBe(12);
  });
});
