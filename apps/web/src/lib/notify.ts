import {
  planEventNotifications, planMessageNotification, planNudge,
  type NotifiableParticipant, type NotificationKind, type PlannedNotification,
} from '@wat/core';
import { query, queryOne } from './db';
import { getPushProvider, type PushMessage } from './push';

/**
 * FR-18 — turning a plan into deliveries, and remembering what went out.
 *
 * The dedupe write happens *before* delivery. If the push service is slow or
 * fails, the worst case is a notification nobody received; recording after
 * would risk a crash between send and write, which means sending it again on
 * the next tick. Silence is a better failure than repetition here.
 */

interface ParticipantRow {
  id: string;
  display_name: string;
  rsvp: NotifiableParticipant['rsvp'];
  status: NotifiableParticipant['status'];
  push_token: string | null;
  muted: boolean;
  arrived_at: Date | null;
  eta_at: Date | null;
  self_reported_eta: Date | null;
}

function toNotifiable(row: ParticipantRow): NotifiableParticipant {
  return {
    id: row.id,
    displayName: row.display_name,
    rsvp: row.rsvp,
    status: row.status,
    pushToken: row.push_token,
    muted: row.muted,
    // A routed ETA when we have one, otherwise what they told us themselves.
    etaAt: row.eta_at?.getTime() ?? row.self_reported_eta?.getTime() ?? null,
    arrivedAt: row.arrived_at?.getTime() ?? null,
  };
}

export async function notifiableParticipants(
  eventId: string,
): Promise<NotifiableParticipant[]> {
  const rows = await query<ParticipantRow>(
    `select p.id, p.display_name, p.rsvp, p.status, p.push_token, p.muted,
            p.arrived_at, p.self_reported_eta, e.eta_at
       from participants p
       left join etas e on e.participant_id = p.id
      where p.event_id = $1`,
    [eventId],
  );
  return rows.map(toNotifiable);
}

async function alreadySent(eventId: string): Promise<Set<string>> {
  const rows = await query<{ participant_id: string; kind: NotificationKind }>(
    `select n.participant_id, n.kind
       from notifications_sent n
       join participants p on p.id = n.participant_id
      where p.event_id = $1`,
    [eventId],
  );
  return new Set(rows.map((row) => `${row.participant_id}:${row.kind}`));
}

function toMessages(
  notification: PlannedNotification,
  byId: Map<string, NotifiableParticipant>,
): PushMessage[] {
  return notification.recipientIds
    .map((id) => byId.get(id))
    .filter((p): p is NotifiableParticipant => p?.pushToken != null)
    .map((p) => ({
      to: p.pushToken as string,
      title: notification.title,
      body: notification.body,
      data: { kind: notification.kind },
    }));
}

async function deliver(
  notifications: readonly PlannedNotification[],
  participants: readonly NotifiableParticipant[],
  options: { record: boolean },
): Promise<number> {
  if (notifications.length === 0) return 0;

  const byId = new Map(participants.map((p) => [p.id, p]));
  const messages: PushMessage[] = [];

  for (const notification of notifications) {
    if (options.record) {
      // Recorded first, deliberately — see the note at the top of this file.
      await query(
        `insert into notifications_sent (participant_id, kind)
         values ($1, $2) on conflict do nothing`,
        [notification.subjectId, notification.kind],
      );
    }
    messages.push(...toMessages(notification, byId));
  }

  const result = await getPushProvider().send(messages);

  // PS-12 — stop using tokens the service says are dead.
  if (result.invalidTokens.length > 0) {
    await query(
      'update participants set push_token = null where push_token = any($1::text[])',
      [result.invalidTokens],
    );
  }

  return result.sent;
}

/** One tick of the notify job for a single event. */
export async function notifyEvent(args: {
  eventId: string;
  eventTitle: string;
  startsAt: number;
  now?: number;
}): Promise<{ planned: number; sent: number }> {
  const participants = await notifiableParticipants(args.eventId);
  const planned = planEventNotifications({
    eventTitle: args.eventTitle,
    startsAt: args.startsAt,
    participants,
    alreadySent: await alreadySent(args.eventId),
    now: args.now ?? Date.now(),
  });

  const sent = await deliver(planned, participants, { record: true });
  return { planned: planned.length, sent };
}

/** FR-18 — one nudge per participant per event, rate limited by the ledger. */
export async function notifyNudge(args: {
  eventId: string;
  eventTitle: string;
  fromParticipantId: string;
  toParticipantId: string;
}): Promise<boolean> {
  const participants = await notifiableParticipants(args.eventId);
  const from = participants.find((p) => p.id === args.fromParticipantId);
  const to = participants.find((p) => p.id === args.toParticipantId);
  if (from === undefined || to === undefined) return false;

  const sent = await alreadySent(args.eventId);
  if (sent.has(`${to.id}:nudge`)) return false;

  const planned = planNudge({ eventTitle: args.eventTitle, from, to });
  if (planned === null) {
    // Still record it: a nudge nobody could receive has been spent, and the
    // person doing the nudging should not be able to retry indefinitely.
    await query(
      `insert into notifications_sent (participant_id, kind)
       values ($1, 'nudge') on conflict do nothing`,
      [to.id],
    );
    return false;
  }

  await deliver([planned], participants, { record: true });
  return true;
}

/** FR-18 — a new message, collapsed into a one-minute window. */
export async function notifyMessage(args: {
  eventId: string;
  eventTitle: string;
  authorId: string;
  now?: number;
}): Promise<boolean> {
  const now = args.now ?? Date.now();
  const participants = await notifiableParticipants(args.eventId);
  const author = participants.find((p) => p.id === args.authorId);
  if (author === undefined) return false;

  const row = await queryOne<{ message_notified_at: Date | null }>(
    'select message_notified_at from events where id = $1',
    [args.eventId],
  );

  const planned = planMessageNotification({
    eventTitle: args.eventTitle,
    author,
    participants,
    lastNotifiedAt: row?.message_notified_at?.getTime() ?? null,
    now,
  });
  if (planned === null) return false;

  await query(
    'update events set message_notified_at = to_timestamp($2/1000.0) where id = $1',
    [args.eventId, now],
  );
  // Message notifications are a window rather than a once-ever fact, so they
  // are not written to the dedupe ledger.
  await deliver([planned], participants, { record: false });
  return true;
}
