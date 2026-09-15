import { describe, expect, it } from 'vitest';
import { boundsFor, mapMarkers, mapViewport } from './map';
import { MINUTE, NOW, enRoute, participant, position } from './test-helpers';

const VENUE = { lat: 40.7188, lng: -73.9938 };

describe('mapMarkers', () => {
  it('shows a dot for someone en route with a fresh fix', () => {
    const markers = mapMarkers([enRoute('Priya', 20_000, NOW + 5 * MINUTE)], NOW);
    expect(markers).toHaveLength(1);
    expect(markers[0]?.state).toBe('fresh');
    expect(markers[0]?.displayName).toBe('Priya');
  });

  it('fades a dot once the fix is over two minutes old', () => {
    const markers = mapMarkers([enRoute('Dev', 3 * MINUTE, NOW + 5 * MINUTE)], NOW);
    expect(markers[0]?.state).toBe('stale');
  });

  it('drops the dot entirely past ten minutes', () => {
    // A dot on a street corner is a stronger claim than a line of text, so it
    // has to expire rather than linger.
    expect(mapMarkers([enRoute('Sam', 11 * MINUTE, NOW)], NOW)).toEqual([]);
  });

  it('shows nothing for someone who has not started', () => {
    expect(mapMarkers([participant({ rsvp: 'going' })], NOW)).toEqual([]);
  });

  it('shows nothing for someone who has arrived — the venue pin covers them', () => {
    const arrived = participant({
      status: 'arrived', arrivedAt: NOW - MINUTE,
      lastPosition: position({ recordedAt: NOW - 30_000 }),
    });
    expect(mapMarkers([arrived], NOW)).toEqual([]);
  });

  it('shows nothing for someone en route who never shared a position', () => {
    const manual = participant({ status: 'en_route', selfReportedEta: NOW + 10 * MINUTE });
    expect(mapMarkers([manual], NOW)).toEqual([]);
  });

  it('carries the colour and travel mode so the dot matches the row', () => {
    const marker = mapMarkers(
      [enRoute('Dev', 10_000, NOW, { color: '#7A5AA8', travelMode: 'transit' })], NOW,
    )[0];
    expect(marker?.color).toBe('#7A5AA8');
    expect(marker?.travelMode).toBe('transit');
  });
});

describe('boundsFor', () => {
  it('returns nothing for no points', () => {
    expect(boundsFor([])).toBeNull();
  });

  it('contains every point it was given', () => {
    const points = [VENUE, { lat: 40.76, lng: -73.95 }, { lat: 40.70, lng: -74.02 }];
    const bounds = boundsFor(points);
    for (const point of points) {
      expect(point.lat).toBeLessThanOrEqual(bounds?.north ?? 0);
      expect(point.lat).toBeGreaterThanOrEqual(bounds?.south ?? 0);
      expect(point.lng).toBeLessThanOrEqual(bounds?.east ?? 0);
      expect(point.lng).toBeGreaterThanOrEqual(bounds?.west ?? 0);
    }
  });

  it('does not zoom to a doorway for a single point', () => {
    const bounds = boundsFor([VENUE]);
    expect((bounds?.north ?? 0) - (bounds?.south ?? 0)).toBeGreaterThan(0.003);
  });

  it('pads, so nothing sits on the edge of the screen', () => {
    const tight = boundsFor([VENUE, { lat: 40.76, lng: -73.95 }], { paddingRatio: 0 });
    const padded = boundsFor([VENUE, { lat: 40.76, lng: -73.95 }], { paddingRatio: 0.5 });
    expect(padded?.north).toBeGreaterThan(tight?.north ?? 0);
    expect(padded?.south).toBeLessThan(tight?.south ?? 0);
  });

  it('never produces a latitude outside the world', () => {
    const bounds = boundsFor([{ lat: 89.99, lng: 0 }, { lat: -89.99, lng: 0 }]);
    expect(bounds?.north).toBeLessThanOrEqual(90);
    expect(bounds?.south).toBeGreaterThanOrEqual(-90);
  });

  it('is stable regardless of the order the points arrive in', () => {
    const a = boundsFor([VENUE, { lat: 40.76, lng: -73.95 }]);
    const b = boundsFor([{ lat: 40.76, lng: -73.95 }, VENUE]);
    expect(a).toEqual(b);
  });
});

describe('mapViewport', () => {
  it('always frames the venue, even when nobody is sharing', () => {
    const bounds = mapViewport(VENUE, []);
    expect(bounds).not.toBeNull();
    expect(VENUE.lat).toBeLessThanOrEqual(bounds?.north ?? 0);
    expect(VENUE.lat).toBeGreaterThanOrEqual(bounds?.south ?? 0);
  });

  it('widens to include everyone who is visibly moving', () => {
    const markers = mapMarkers(
      [enRoute('Dev', 10_000, NOW, {
        lastPosition: { lat: 40.80, lng: -73.95, accuracyM: 10, recordedAt: NOW },
      })],
      NOW,
    );
    const withDev = mapViewport(VENUE, markers);
    const aloneAtVenue = mapViewport(VENUE, []);
    expect(withDev?.north).toBeGreaterThan(aloneAtVenue?.north ?? 0);
  });
});
