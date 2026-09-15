import {
  ARRIVAL_RADIUS_M, CHECKIN_CLOSES_AFTER_MS, TRACKING_SAFETY_TIMEOUT_MS,
} from './constants';
import { trackingTier, type TrackingTier } from './geo';
import type { LatLng, ParticipantStatus } from './types';

/**
 * FR-10 — how hard the device should be working.
 *
 * Continuous background GPS is the reason for going native and also the
 * fastest way to drain a battery and fail store review. The answer is to spend
 * accuracy only where it buys something: nobody needs metre-accuracy to be told
 * a friend is forty minutes out.
 *
 * These settings are expressed in neutral terms here and mapped onto
 * expo-location in the app, so the policy itself stays testable without a
 * device.
 */

export type TrackingAccuracy = 'balanced' | 'high';

export interface TrackingConfig {
  tier: TrackingTier;
  accuracy: TrackingAccuracy;
  /** Only report after moving this far. The main battery lever. */
  distanceFilterM: number;
  /** Batch updates for this long before waking the app. */
  deferredIntervalMs: number;
  /** Floor on how often the OS should hand us a fix. */
  minIntervalMs: number;
}

const FAR: Omit<TrackingConfig, 'tier'> = {
  accuracy: 'balanced',
  distanceFilterM: 500,
  deferredIntervalMs: 120_000,
  minIntervalMs: 60_000,
};

const APPROACHING: Omit<TrackingConfig, 'tier'> = {
  accuracy: 'high',
  distanceFilterM: 50,
  deferredIntervalMs: 30_000,
  minIntervalMs: 15_000,
};

/**
 * Inside the geofence the OS region monitor takes over, so the app itself can
 * stop asking for fixes entirely.
 */
const ARRIVED: Omit<TrackingConfig, 'tier'> = {
  accuracy: 'balanced',
  distanceFilterM: ARRIVAL_RADIUS_M,
  deferredIntervalMs: 120_000,
  minIntervalMs: 60_000,
};

export function trackingConfigFor(position: LatLng, venue: LatLng): TrackingConfig {
  const tier = trackingTier(position, venue);
  const base = tier === 'far' ? FAR : tier === 'approaching' ? APPROACHING : ARRIVED;
  return { tier, ...base };
}

/**
 * Changing tracking settings restarts the OS location task, which itself costs
 * power — so only do it when the tier actually changed.
 */
export function shouldReconfigure(
  current: TrackingTier | null,
  next: TrackingTier,
): boolean {
  return current !== next;
}

/**
 * FR-10/PS-2 — every reason tracking must stop.
 *
 * A location task that outlives its event is not a tidiness problem: it is a
 * phone quietly reporting someone's position to a group that stopped caring
 * hours ago. So the rule is written once, tested, and checked on every single
 * background wake rather than only where it seemed relevant.
 */
export type StopReason =
  | 'arrived'
  | 'sharing_off'
  | 'event_over'
  | 'safety_timeout'
  | 'left_event';

export function stopTrackingReason(state: {
  status: ParticipantStatus;
  sharing: boolean;
  /** False once the participant is no longer part of the event at all. */
  inEvent: boolean;
  eventStartsAt: number;
  trackingStartedAt: number;
  now: number;
}): StopReason | null {
  if (!state.inEvent) return 'left_event';
  if (state.status === 'arrived') return 'arrived';
  if (!state.sharing) return 'sharing_off';

  // The event's own window closed.
  if (state.now > state.eventStartsAt + CHECKIN_CLOSES_AFTER_MS) return 'event_over';

  // Backstop for everything the other rules missed — a crashed app, a
  // never-delivered arrival, a clock that jumped. Nothing tracks for longer
  // than this, ever.
  if (state.now - state.trackingStartedAt > TRACKING_SAFETY_TIMEOUT_MS) {
    return 'safety_timeout';
  }

  return null;
}

/** What the user is told when tracking stopped without them asking. */
export function stopReasonMessage(reason: StopReason): string {
  switch (reason) {
    case 'arrived':
      return "You're here — location sharing has stopped.";
    case 'sharing_off':
      return 'Location sharing is off.';
    case 'event_over':
      return 'The event is over, so location sharing has stopped.';
    case 'safety_timeout':
      return 'Location sharing stopped automatically after four hours.';
    case 'left_event':
      return 'You left the event, so location sharing has stopped.';
  }
}
