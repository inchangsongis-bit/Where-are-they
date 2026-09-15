import type { ParticipantStatus, Rsvp } from './types';

/**
 * FR-18 — deciding what to send.
 *
 * The whole risk of this feature is noise. An app that buzzes six phones every
 * time anyone moves gets muted before the second dinner, and a muted app
 * cannot tell you that Priya is five minutes away. So every rule here is a
 * rule about *not* sending: once per subject, never to yourself, never to
 * someone who muted, and never for something the recipient already knows.
 */

export type NotificationKind = 'proximity' | 'all_here' | 'nudge' | 'late' | 'message';

/** How close, in minutes, counts as "nearly here". */
export const PROXIMITY_MINUTES = 5;

/** A burst of messages inside this window is one notification, not five. */
export const MESSAGE_COLLAPSE_MS = 60_000;

export interface NotifiableParticipant {
  id: string;
  displayName: string;
  rsvp: Rsvp;
  status: ParticipantStatus;
  pushToken: string | null;
  muted: boolean;
  /** Best available arrival estimate, routed or self-reported. */
  etaAt: number | null;
  arrivedAt: number | null;
}

export interface PlannedNotification {
  kind: NotificationKind;
  /** Who the notification is *about*. Dedupe is keyed on this. */
  subjectId: string;
  recipientIds: string[];
  title: string;
  body: string;
}

/** Who can actually receive anything: has a token, has not muted. */
function reachable(participant: NotifiableParticipant): boolean {
  return participant.pushToken !== null && !participant.muted;
}

function isComing(participant: NotifiableParticipant): boolean {
  return participant.rsvp !== 'cant';
}

/**
 * The notifications an event tick should produce, given what has already been
 * sent. Pure: the caller supplies `alreadySent` and persists the result.
 */
export function planEventNotifications(args: {
  eventTitle: string;
  startsAt: number;
  participants: readonly NotifiableParticipant[];
  /** Keys of the form `${subjectId}:${kind}` already recorded. */
  alreadySent: ReadonlySet<string>;
  now: number;
}): PlannedNotification[] {
  const { participants, alreadySent, now } = args;
  const planned: PlannedNotification[] = [];

  const sent = (subjectId: string, kind: NotificationKind): boolean =>
    alreadySent.has(`${subjectId}:${kind}`);

  const others = (exceptId: string): string[] =>
    participants
      .filter((p) => p.id !== exceptId && reachable(p))
      .map((p) => p.id);

  // --- proximity: the one notification people actually want ---------------
  for (const participant of participants) {
    if (participant.status !== 'en_route') continue;
    if (participant.etaAt === null) continue;
    if (sent(participant.id, 'proximity')) continue;

    const minutesAway = (participant.etaAt - now) / 60_000;
    // Below zero means the estimate has gone stale rather than that they have
    // arrived — arrival is its own signal, so don't announce on a negative.
    if (minutesAway < 0 || minutesAway > PROXIMITY_MINUTES) continue;

    const recipients = others(participant.id);
    if (recipients.length === 0) continue;

    planned.push({
      kind: 'proximity',
      subjectId: participant.id,
      recipientIds: recipients,
      title: args.eventTitle,
      body: `${participant.displayName} is ${PROXIMITY_MINUTES} minutes away`,
    });
  }

  // --- all here -----------------------------------------------------------
  const coming = participants.filter(isComing);
  const lastArrival = coming.reduce<NotifiableParticipant | null>(
    (latest, participant) =>
      participant.arrivedAt !== null &&
      (latest === null || participant.arrivedAt > (latest.arrivedAt ?? 0))
        ? participant
        : latest,
    null,
  );

  if (
    coming.length > 1 &&
    coming.every((participant) => participant.status === 'arrived') &&
    lastArrival !== null &&
    !sent(lastArrival.id, 'all_here')
  ) {
    const recipients = participants.filter(reachable).map((p) => p.id);
    if (recipients.length > 0) {
      planned.push({
        kind: 'all_here',
        subjectId: lastArrival.id,
        recipientIds: recipients,
        title: args.eventTitle,
        body: 'Everyone is here',
      });
    }
  }

  // --- late: to yourself only ---------------------------------------------
  for (const participant of participants) {
    if (participant.status !== 'en_route') continue;
    if (participant.etaAt === null) continue;
    if (participant.etaAt <= args.startsAt) continue;
    if (sent(participant.id, 'late')) continue;
    if (!reachable(participant)) continue;

    planned.push({
      kind: 'late',
      subjectId: participant.id,
      // You are the only person who can do anything about your own lateness,
      // and the group can already see it on the list.
      recipientIds: [participant.id],
      title: args.eventTitle,
      body: "You're running later than the start time",
    });
  }

  return planned;
}

/** FR-18 — a nudge, which is a user action rather than a tick. */
export function planNudge(args: {
  eventTitle: string;
  from: NotifiableParticipant;
  to: NotifiableParticipant;
}): PlannedNotification | null {
  if (!reachable(args.to)) return null;
  return {
    kind: 'nudge',
    subjectId: args.to.id,
    recipientIds: [args.to.id],
    title: args.eventTitle,
    body: `${args.from.displayName} is wondering where you are`,
  };
}

/** FR-18 — a new message, collapsed and never echoed back to its author. */
export function planMessageNotification(args: {
  eventTitle: string;
  author: NotifiableParticipant;
  participants: readonly NotifiableParticipant[];
  lastNotifiedAt: number | null;
  now: number;
}): PlannedNotification | null {
  if (
    args.lastNotifiedAt !== null &&
    args.now - args.lastNotifiedAt < MESSAGE_COLLAPSE_MS
  ) {
    return null;
  }

  const recipients = args.participants
    .filter((p) => p.id !== args.author.id && reachable(p))
    .map((p) => p.id);
  if (recipients.length === 0) return null;

  return {
    kind: 'message',
    subjectId: args.author.id,
    recipientIds: recipients,
    title: args.eventTitle,
    body: `${args.author.displayName} said something`,
  };
}
