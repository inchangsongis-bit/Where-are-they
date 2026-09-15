import type { Participant, Position } from './types';

export const MINUTE = 60_000;
export const NOW = Date.UTC(2026, 8, 10, 18, 30, 0); // 18:30 UTC

export function position(overrides: Partial<Position> = {}): Position {
  return {
    lat: 40.7188,
    lng: -73.9938,
    accuracyM: 12,
    recordedAt: NOW,
    ...overrides,
  };
}

export function participant(overrides: Partial<Participant> = {}): Participant {
  return {
    id: 'p1',
    displayName: 'Ana',
    color: '#0B6E63',
    isOrganizer: false,
    rsvp: 'going',
    status: 'not_started',
    travelMode: 'driving',
    trackingSource: 'app_foreground',
    sharing: false,
    selfReportedEta: null,
    arrivedAt: null,
    muted: false,
    lastPosition: null,
    eta: null,
    ...overrides,
  };
}

/** An en-route participant whose position is `ageMs` old with an ETA at `etaAt`. */
export function enRoute(
  name: string,
  ageMs: number,
  etaAt: number | null,
  overrides: Partial<Participant> = {},
): Participant {
  return participant({
    id: name.toLowerCase(),
    displayName: name,
    status: 'en_route',
    sharing: true,
    lastPosition: position({ recordedAt: NOW - ageMs }),
    eta:
      etaAt === null
        ? null
        : {
            etaAt,
            distanceM: 2_400,
            durationS: 600,
            source: 'routed',
            computedAt: NOW - ageMs,
          },
    ...overrides,
  });
}
