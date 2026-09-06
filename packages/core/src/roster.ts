import type { Participant } from './types.js';
import { arrivalDisplay, displayTime } from './display.js';

/**
 * FR-12 — the order the live view lists people in.
 *
 * Arrived first (they are the ones you can start ordering with), then whoever
 * is closest to walking in, then people who haven't set off, then the
 * maybes, then the nos. Status beats RSVP: someone who said "maybe" and is
 * now driving over belongs with the people who are coming.
 */
const RANK = {
  arrived: 0,
  enRoute: 1,
  notStarted: 2,
  maybe: 3,
  cant: 4,
} as const;

function rank(participant: Participant): number {
  if (participant.status === 'arrived') return RANK.arrived;
  if (participant.status === 'en_route') return RANK.enRoute;
  if (participant.rsvp === 'cant') return RANK.cant;
  if (participant.rsvp === 'maybe') return RANK.maybe;
  return RANK.notStarted;
}

export function sortRoster(
  participants: readonly Participant[],
  now: number,
): Participant[] {
  return [...participants].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;

    // Within a band, soonest first. Anyone we can't place goes last rather
    // than jumping the queue on a missing value.
    const aAt = displayTime(arrivalDisplay(a, now));
    const bAt = displayTime(arrivalDisplay(b, now));
    if (aAt !== null && bAt !== null && aAt !== bAt) return aAt - bAt;
    if (aAt !== null && bAt === null) return -1;
    if (aAt === null && bAt !== null) return 1;

    return a.displayName.localeCompare(b.displayName);
  });
}

export interface RosterSummary {
  here: number;
  onTheWay: number;
  notStarted: number;
  notComing: number;
}

/** The "3 here · 2 on the way · 1 pending" line above the list. */
export function summarise(participants: readonly Participant[]): RosterSummary {
  const summary: RosterSummary = {
    here: 0,
    onTheWay: 0,
    notStarted: 0,
    notComing: 0,
  };

  for (const participant of participants) {
    if (participant.status === 'arrived') summary.here += 1;
    else if (participant.status === 'en_route') summary.onTheWay += 1;
    else if (participant.rsvp === 'cant') summary.notComing += 1;
    else summary.notStarted += 1;
  }

  return summary;
}

/**
 * FR-12 — the headline figure: when the group is actually complete.
 *
 * It is the *latest* ETA among the people who are coming, because the group is
 * only whole once the last person walks in. Returns null while anyone coming
 * has no usable estimate — an optimistic headline built on missing data is
 * worse than no headline.
 */
export function everyoneHereBy(
  participants: readonly Participant[],
  now: number,
): number | null {
  let latest: number | null = null;

  for (const participant of participants) {
    if (participant.rsvp === 'cant') continue;
    if (participant.status === 'arrived') continue;
    if (participant.rsvp === 'maybe') continue;

    const at = displayTime(arrivalDisplay(participant, now));
    if (at === null) return null;
    if (latest === null || at > latest) latest = at;
  }

  return latest;
}
