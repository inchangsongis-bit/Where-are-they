import { distanceM } from './geo';
import type { Eta, LatLng, TravelMode } from './types';

/**
 * FR-11 — the fallback when routing is unavailable.
 *
 * A straight line between two points is not a journey, so this is deliberately
 * pessimistic in two ways: an assumed speed well below the vehicle's top speed,
 * and a detour factor for the fact that roads do not go where crows fly. It is
 * labelled `straight_line` all the way to the UI so nobody mistakes it for a
 * routed answer.
 */

/** Metres per second. Urban averages, not top speeds. */
export const ASSUMED_SPEED_MPS: Record<TravelMode, number> = {
  driving: 8.3, // ~30 km/h, city traffic and lights
  walking: 1.35, // ~4.9 km/h
  cycling: 4.2, // ~15 km/h
  transit: 5.5, // ~20 km/h including waiting and changes
};

/**
 * Roads are longer than the line between their ends. These are rough and
 * deliberately conservative — underpromising an ETA is far cheaper than a
 * group deciding to order because someone looked two minutes away.
 */
export const DETOUR_FACTOR: Record<TravelMode, number> = {
  driving: 1.35,
  walking: 1.25,
  cycling: 1.3,
  transit: 1.45,
};

/** Nobody is ever "arriving now" while still en route. */
const MINIMUM_DURATION_S = 60;

export function straightLineEta(
  from: LatLng,
  venue: LatLng,
  mode: TravelMode,
  now: number,
): Eta {
  const asTheCrowFlies = distanceM(from, venue);
  const distance = asTheCrowFlies * DETOUR_FACTOR[mode];
  const durationS = Math.max(
    MINIMUM_DURATION_S,
    Math.round(distance / ASSUMED_SPEED_MPS[mode]),
  );

  return {
    etaAt: now + durationS * 1_000,
    distanceM: Math.round(distance),
    durationS,
    source: 'straight_line',
    computedAt: now,
  };
}
