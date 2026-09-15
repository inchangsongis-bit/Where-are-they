import { ARRIVAL_DWELL_MS, ARRIVAL_RADIUS_M } from './constants';
import { distanceM } from './geo';
import type { LatLng } from './types';

/**
 * FR-14 — arrival needs dwell, not just proximity.
 *
 * A single fix inside the radius is not arrival: GPS drifts, and people walk
 * past the door on the way to park. So we track *since when* a device has been
 * continuously inside, and only call it arrived once that has held.
 *
 * The state is one nullable timestamp, which is all the server needs to store.
 */
export function nextDwellStart(
  insideSince: number | null,
  position: LatLng,
  venue: LatLng,
  now: number,
): number | null {
  const inside = distanceM(position, venue) <= ARRIVAL_RADIUS_M;
  if (!inside) return null; // Left the radius: the clock restarts from zero.
  return insideSince ?? now;
}

export function hasDwelledLongEnough(
  insideSince: number | null,
  now: number,
): boolean {
  if (insideSince === null) return false;
  return now - insideSince >= ARRIVAL_DWELL_MS;
}

/** Convenience for the ingest path: the new dwell start and whether to arrive. */
export function evaluateArrival(args: {
  insideSince: number | null;
  position: LatLng;
  venue: LatLng;
  now: number;
}): { insideSince: number | null; arrived: boolean } {
  const insideSince = nextDwellStart(
    args.insideSince, args.position, args.venue, args.now,
  );
  return { insideSince, arrived: hasDwelledLongEnough(insideSince, args.now) };
}
