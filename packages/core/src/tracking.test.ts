import { describe, expect, it } from 'vitest';
import {
  shouldReconfigure, stopReasonMessage, stopTrackingReason, trackingConfigFor,
  type StopReason,
} from './tracking';
import { CHECKIN_CLOSES_AFTER_MS, TRACKING_SAFETY_TIMEOUT_MS } from './constants';

const VENUE = { lat: 40.7188, lng: -73.9938 };
const AT_DOOR = { lat: 40.71885, lng: -73.99385 };
const NEARBY = { lat: 40.7338, lng: -73.9938 }; // ~1.7km
const FAR_AWAY = { lat: 40.79, lng: -73.95 }; // ~9km
const NOW = Date.UTC(2026, 8, 10, 23, 0, 0);

describe('trackingConfigFor', () => {
  it('is cheap and coarse when someone is far out', () => {
    const config = trackingConfigFor(FAR_AWAY, VENUE);
    expect(config.tier).toBe('far');
    expect(config.accuracy).toBe('balanced');
    expect(config.distanceFilterM).toBe(500);
  });

  it('becomes accurate only once they are close enough for it to matter', () => {
    const config = trackingConfigFor(NEARBY, VENUE);
    expect(config.tier).toBe('approaching');
    expect(config.accuracy).toBe('high');
    expect(config.distanceFilterM).toBe(50);
  });

  it('spends less power the further away someone is', () => {
    const far = trackingConfigFor(FAR_AWAY, VENUE);
    const close = trackingConfigFor(NEARBY, VENUE);
    expect(far.distanceFilterM).toBeGreaterThan(close.distanceFilterM);
    expect(far.deferredIntervalMs).toBeGreaterThan(close.deferredIntervalMs);
    expect(far.minIntervalMs).toBeGreaterThan(close.minIntervalMs);
  });

  it('backs off again at the venue, where the geofence takes over', () => {
    const config = trackingConfigFor(AT_DOOR, VENUE);
    expect(config.tier).toBe('arrived');
    expect(config.accuracy).toBe('balanced');
  });

  it('never asks for updates more often than every 15 seconds', () => {
    for (const position of [AT_DOOR, NEARBY, FAR_AWAY]) {
      expect(trackingConfigFor(position, VENUE).minIntervalMs).toBeGreaterThanOrEqual(15_000);
    }
  });
});

describe('shouldReconfigure', () => {
  it('reconfigures on the first fix', () => {
    expect(shouldReconfigure(null, 'far')).toBe(true);
  });

  it('reconfigures when crossing into a new tier', () => {
    expect(shouldReconfigure('far', 'approaching')).toBe(true);
  });

  it('leaves the task alone within a tier — restarting it costs power too', () => {
    expect(shouldReconfigure('approaching', 'approaching')).toBe(false);
  });
});

describe('stopTrackingReason', () => {
  const base = {
    status: 'en_route' as const,
    sharing: true,
    inEvent: true,
    eventStartsAt: NOW,
    trackingStartedAt: NOW - 20 * 60_000,
    now: NOW,
  };

  it('keeps tracking someone who is genuinely on their way', () => {
    expect(stopTrackingReason(base)).toBeNull();
  });

  it('stops on arrival', () => {
    expect(stopTrackingReason({ ...base, status: 'arrived' })).toBe('arrived');
  });

  it('stops when the person turned sharing off', () => {
    expect(stopTrackingReason({ ...base, sharing: false })).toBe('sharing_off');
  });

  it('stops when they are no longer in the event at all', () => {
    expect(stopTrackingReason({ ...base, inEvent: false })).toBe('left_event');
  });

  it('stops once the event window has closed', () => {
    expect(
      stopTrackingReason({ ...base, now: NOW + CHECKIN_CLOSES_AFTER_MS + 60_000 }),
    ).toBe('event_over');
  });

  it('stops after four hours no matter what else looks fine', () => {
    // A long dinner keeps the event window open, so only the backstop catches
    // this. Without it a crashed app could report someone's position all night.
    expect(
      stopTrackingReason({
        ...base,
        eventStartsAt: NOW + 10 * 60 * 60_000, // window still wide open
        trackingStartedAt: NOW - TRACKING_SAFETY_TIMEOUT_MS - 60_000,
      }),
    ).toBe('safety_timeout');
  });

  it('checks leaving the event before anything else', () => {
    expect(
      stopTrackingReason({ ...base, inEvent: false, status: 'arrived', sharing: false }),
    ).toBe('left_event');
  });

  it('never returns null for a participant who has arrived, whatever else is set', () => {
    expect(
      stopTrackingReason({ ...base, status: 'arrived', sharing: true }),
    ).not.toBeNull();
  });
});

describe('stopReasonMessage', () => {
  const reasons: StopReason[] = [
    'arrived', 'sharing_off', 'event_over', 'safety_timeout', 'left_event',
  ];

  it.each(reasons)('explains %s in plain language', (reason) => {
    const message = stopReasonMessage(reason);
    expect(message.length).toBeGreaterThan(10);
    expect(message).not.toMatch(/error|failed|undefined/i);
  });
});
