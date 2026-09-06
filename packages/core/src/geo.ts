import type { LatLng } from './types.js';
import { APPROACH_RADIUS_M, ARRIVAL_RADIUS_M } from './constants.js';

const EARTH_RADIUS_M = 6_371_008.8;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Great-circle distance in metres. Accurate enough at city scale. */
export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** FR-14 — inside the arrival geofence. */
export function isAtVenue(position: LatLng, venue: LatLng): boolean {
  return distanceM(position, venue) <= ARRIVAL_RADIUS_M;
}

/**
 * FR-10 — which tracking tier a position belongs in. Battery lives or dies
 * here: tier 1 is coarse and cheap, tier 2 is accurate and expensive.
 */
export type TrackingTier = 'far' | 'approaching' | 'arrived';

export function trackingTier(position: LatLng, venue: LatLng): TrackingTier {
  const metres = distanceM(position, venue);
  if (metres <= ARRIVAL_RADIUS_M) return 'arrived';
  if (metres <= APPROACH_RADIUS_M) return 'approaching';
  return 'far';
}

/**
 * Coordinates are rounded before storage (PS-8) — five decimals is about a
 * metre, which is finer than any consumer GPS fix and coarse enough not to
 * pinpoint a doorway.
 */
export function roundCoordinate(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}

export function roundPosition<T extends LatLng>(position: T): T {
  return {
    ...position,
    lat: roundCoordinate(position.lat),
    lng: roundCoordinate(position.lng),
  };
}
