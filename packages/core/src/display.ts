import type { Participant } from './types.js';
import { positionFreshness } from './freshness.js';

/**
 * FR-11/FR-12 — exactly what one row in the live view says about arrival.
 *
 * This is the single most-copied piece of logic in the product, so it exists
 * once. If the native app and the web app ever disagree about whether an ETA
 * is trustworthy, the group stops trusting both.
 */
export type ArrivalDisplay =
  | { kind: 'arrived'; at: number }
  | { kind: 'eta'; at: number; stale: boolean }
  | { kind: 'self_reported'; at: number }
  | { kind: 'last_seen'; agoMs: number }
  | { kind: 'unknown' };

export function arrivalDisplay(
  participant: Participant,
  now: number,
): ArrivalDisplay {
  if (participant.status === 'arrived' && participant.arrivedAt !== null) {
    return { kind: 'arrived', at: participant.arrivedAt };
  }

  const position = participant.lastPosition;
  const freshness =
    position === null ? null : positionFreshness(position.recordedAt, now);

  // A live ETA, as long as the position behind it is still worth believing.
  if (participant.eta !== null && freshness !== null && freshness !== 'expired') {
    return { kind: 'eta', at: participant.eta.etaAt, stale: freshness === 'stale' };
  }

  // No usable position, but they told us themselves — better than nothing,
  // and never worse than the group chat.
  if (participant.selfReportedEta !== null) {
    return { kind: 'self_reported', at: participant.selfReportedEta };
  }

  // We had them once. Say how long ago rather than pretending to an ETA.
  if (position !== null) {
    return { kind: 'last_seen', agoMs: now - position.recordedAt };
  }

  return { kind: 'unknown' };
}

/** The time an ArrivalDisplay implies, or null when it implies none. */
export function displayTime(display: ArrivalDisplay): number | null {
  switch (display.kind) {
    case 'arrived':
      return display.at;
    case 'eta':
    case 'self_reported':
      return display.at;
    case 'last_seen':
    case 'unknown':
      return null;
  }
}

/** FR-12 — flags a participant who will not make the start time. */
export function isLate(
  participant: Participant,
  startsAt: number,
  now: number,
): boolean {
  if (participant.status === 'arrived') return false;
  const at = displayTime(arrivalDisplay(participant, now));
  return at !== null && at > startsAt;
}

/** Locale-aware clock time, e.g. "7:34 PM". Durations coordinate worse. */
export function formatClockTime(
  timestamp: number,
  timezone: string,
  locale?: string,
): string {
  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
  }).format(new Date(timestamp));
}

/** "11 min ago", "just now" — the honest half of the staleness rule. */
export function formatAge(agoMs: number): string {
  const minutes = Math.floor(agoMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes === 1) return '1 min ago';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours === 1 ? '1 hr ago' : `${hours} hr ago`;
}
