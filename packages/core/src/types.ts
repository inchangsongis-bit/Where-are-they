/** Domain types for Release 1. Accounts, groups and bills arrive in R2/R3. */

export type Rsvp = 'pending' | 'going' | 'maybe' | 'cant';
export type ParticipantStatus = 'not_started' | 'en_route' | 'arrived';
export type TravelMode = 'driving' | 'walking' | 'transit' | 'cycling';

/**
 * How a participant's position reaches us. Shown in the UI so a gap in
 * updates reads as expected rather than broken (FR-11).
 */
export type TrackingSource =
  | 'app_background'
  | 'app_foreground'
  | 'web'
  | 'manual';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Position extends LatLng {
  accuracyM: number;
  /** Client clock, not server receipt — offline queues flush late (NFR). */
  recordedAt: number;
}

export interface Venue extends LatLng {
  name: string;
  address: string;
}

export interface Eta {
  /** Absolute arrival time. Clock times coordinate a group better than durations. */
  etaAt: number;
  distanceM: number;
  durationS: number;
  source: 'routed' | 'straight_line';
  computedAt: number;
}

export interface Participant {
  id: string;
  displayName: string;
  color: string;
  isOrganizer: boolean;
  rsvp: Rsvp;
  status: ParticipantStatus;
  travelMode: TravelMode;
  trackingSource: TrackingSource;
  sharing: boolean;
  /** Manual fallback when location is denied or unavailable (FR-9). */
  selfReportedEta: number | null;
  arrivedAt: number | null;
  lastPosition: Position | null;
  eta: Eta | null;
}

export interface EventSummary {
  id: string;
  token: string;
  title: string;
  venue: Venue;
  startsAt: number;
  timezone: string;
  status: 'active' | 'cancelled';
}
