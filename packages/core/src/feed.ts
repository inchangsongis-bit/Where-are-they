import { MESSAGE_MAX } from './constants';
import type { Participant } from './types';

/**
 * FR-15 — the event feed.
 *
 * The group already has a group chat, so this only earns its place by being
 * the one thread where messages sit next to arrivals and ETAs. That is why
 * system events are entries in the same list rather than a separate activity
 * log: "should we order?" belongs directly under "Marco arrived 7:24".
 */

export type FeedKind =
  | 'text'
  | 'joined'
  | 'rsvp'
  | 'checked_in'
  | 'arrived'
  | 'late'
  | 'cancelled';

export interface FeedEntry {
  id: string;
  kind: FeedKind;
  participantId: string | null;
  /** Denormalised so a departed participant's entries still read correctly. */
  authorName: string | null;
  body: string | null;
  meta: Record<string, unknown> | null;
  createdAt: number;
}

export function isSystemEntry(entry: FeedEntry): boolean {
  return entry.kind !== 'text';
}

/**
 * The sentence a system entry renders as. Written from the group's side of the
 * screen — what happened, not which row changed.
 */
export function describeEntry(entry: FeedEntry): string {
  const who = entry.authorName ?? 'Someone';

  switch (entry.kind) {
    case 'text':
      return entry.body ?? '';
    case 'joined':
      return entry.meta?.['organizer'] === true
        ? `${who} started this`
        : `${who} joined`;
    case 'checked_in':
      return `${who} is on the way`;
    case 'arrived':
      return `${who} arrived`;
    case 'late':
      return `${who} is running late`;
    case 'cancelled':
      return `${who} cancelled this`;
    case 'rsvp': {
      const rsvp = entry.meta?.['rsvp'];
      if (rsvp === 'going') return `${who} is coming`;
      if (rsvp === 'maybe') return `${who} might come`;
      if (rsvp === 'cant') return `${who} can't make it`;
      return `${who} replied`;
    }
  }
}

/**
 * FR-15 — the three things people actually send. Tapping one is a single
 * action, not a typing exercise, and two of them change state as well as
 * saying something, so the feed and the list cannot contradict each other.
 */
export interface QuickReply {
  id: string;
  label: string;
  message: string;
  /** Minutes late, when the reply should also move the sender's ETA. */
  lateMinutes?: number;
  /** Whether the reply should also check the sender in. */
  checksIn?: boolean;
}

export const QUICK_REPLIES: readonly QuickReply[] = [
  { id: 'omw', label: 'On my way', message: 'On my way', checksIn: true },
  { id: 'late10', label: 'Running 10 late', message: 'Running 10 minutes late', lateMinutes: 10 },
  { id: 'table', label: 'Grab a table', message: 'Grab a table' },
];

/**
 * "Running 10 late" means ten minutes later than planned — so it counts from
 * the start time, or from now if the start time has already passed. Counting
 * from now alone would let someone an hour late claim to be ten minutes away.
 */
export function lateEta(startsAt: number, minutes: number, now: number): number {
  return Math.max(startsAt, now) + minutes * 60_000;
}

/**
 * Unread counts ignore your own entries and every system event: a badge that
 * lights up because you yourself arrived is noise.
 */
export function unreadCount(
  entries: readonly FeedEntry[],
  lastReadAt: number | null,
  myParticipantId: string | null,
): number {
  return entries.filter(
    (entry) =>
      entry.kind === 'text' &&
      entry.participantId !== myParticipantId &&
      (lastReadAt === null || entry.createdAt > lastReadAt),
  ).length;
}

/** Oldest first, which is how a thread reads. */
export function sortEntries(entries: readonly FeedEntry[]): FeedEntry[] {
  return [...entries].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

/** FR-15 — text only, bounded, and never silently truncated. */
export function messageTooLong(body: string): boolean {
  return body.trim().length > MESSAGE_MAX;
}

/** Participants keyed by id, for turning authorship into names. */
export function nameLookup(
  participants: readonly Participant[],
): Map<string, string> {
  return new Map(participants.map((p) => [p.id, p.displayName]));
}
