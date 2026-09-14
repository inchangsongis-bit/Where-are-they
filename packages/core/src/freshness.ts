import type { LatLng, Position } from './types';
import { distanceM } from './geo';
import {
  ETA_RECOMPUTE_DISTANCE_M,
  MIN_ETA_INTERVAL_MS,
  MIN_POSITION_DISTANCE_M,
  MIN_POSITION_INTERVAL_MS,
  POSITION_EXPIRED_AFTER_MS,
  POSITION_STALE_AFTER_MS,
} from './constants';

/**
 * FR-11 — how much a position can still be trusted.
 *
 * `fresh`   shown normally
 * `stale`   shown greyed out; the number is probably still roughly right
 * `expired` not shown at all; we say "last seen 14 min ago" instead
 *
 * Guessing past this point is what makes people stop believing the app.
 */
export type Freshness = 'fresh' | 'stale' | 'expired';

export function positionFreshness(recordedAt: number, now: number): Freshness {
  const age = now - recordedAt;
  if (age >= POSITION_EXPIRED_AFTER_MS) return 'expired';
  if (age >= POSITION_STALE_AFTER_MS) return 'stale';
  return 'fresh';
}

/**
 * FR-9 — throttle. Both conditions must hold, which is what keeps the battery
 * and data budgets in NFR reachable: a phone sitting still sends nothing.
 */
export function shouldSendPosition(
  last: Position | null,
  next: Position,
): boolean {
  if (last === null) return true;
  if (next.recordedAt - last.recordedAt < MIN_POSITION_INTERVAL_MS) return false;
  return distanceM(last, next) >= MIN_POSITION_DISTANCE_M;
}

/**
 * FR-11 — recompute an ETA on a timer, or early if they have covered real
 * ground. Routing calls are the one metered cost in the product.
 */
export function shouldRecomputeEta(args: {
  lastComputedAt: number | null;
  lastComputedFrom: LatLng | null;
  current: LatLng;
  now: number;
}): boolean {
  const { lastComputedAt, lastComputedFrom, current, now } = args;
  if (lastComputedAt === null || lastComputedFrom === null) return true;
  if (now - lastComputedAt >= MIN_ETA_INTERVAL_MS) return true;
  return distanceM(lastComputedFrom, current) >= ETA_RECOMPUTE_DISTANCE_M;
}
