import {
  DISPLAY_NAME_MAX,
  MAX_PARTICIPANTS,
  generateEventToken,
  retentionSchedule,
  type Participant,
  type Rsvp,
  type TravelMode,
} from '@wat/core';
import { query, queryOne, transaction } from './db';
import { conflict, notFound } from './errors';
import { hashPin } from './pin';
import { issueSession, type IssuedSession } from './session';

/** Deterministic avatar colour, so a person looks the same to everyone. */
const PALETTE = [
  '#0B6E63', '#7A5AA8', '#B24A17', '#2C7A4C',
  '#8A6A16', '#3A6EA5', '#A03D6B', '#5C6B66',
] as const;

function colorFor(seat: number): string {
  return PALETTE[seat % PALETTE.length] ?? '#5C6B66';
}

interface EventRow {
  id: string;
  token: string;
  title: string;
  place_name: string;
  place_address: string;
  place_lat: number;
  place_lng: number;
  starts_at: Date;
  timezone: string;
  status: 'active' | 'cancelled';
  pin_hash: string | null;
}

interface ParticipantRow {
  id: string;
  display_name: string;
  color: string;
  is_organizer: boolean;
  rsvp: Rsvp;
  status: Participant['status'];
  travel_mode: TravelMode;
  tracking_source: Participant['trackingSource'];
  sharing: boolean;
  self_reported_eta: Date | null;
  arrived_at: Date | null;
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  recorded_at: Date | null;
  eta_at: Date | null;
  eta_distance_m: number | null;
  eta_duration_s: number | null;
  eta_source: 'routed' | 'straight_line' | null;
  eta_computed_at: Date | null;
}

export interface EventRecord {
  id: string;
  token: string;
  title: string;
  venue: { name: string; address: string; lat: number; lng: number };
  startsAt: number;
  timezone: string;
  status: 'active' | 'cancelled';
  hasPin: boolean;
}

export interface CreateEventInput {
  title: string;
  placeName: string;
  placeAddress: string;
  lat: number;
  lng: number;
  startsAt: number;
  timezone: string;
  pin?: string | undefined;
  organizerName: string;
}

export interface CreatedEvent {
  event: EventRecord;
  participantId: string;
  session: IssuedSession;
}

function toEventRecord(row: EventRow): EventRecord {
  return {
    id: row.id,
    token: row.token,
    title: row.title,
    venue: {
      name: row.place_name,
      address: row.place_address,
      lat: row.place_lat,
      lng: row.place_lng,
    },
    startsAt: row.starts_at.getTime(),
    timezone: row.timezone,
    status: row.status,
    hasPin: row.pin_hash !== null,
  };
}

function toParticipant(row: ParticipantRow): Participant {
  return {
    id: row.id,
    displayName: row.display_name,
    color: row.color,
    isOrganizer: row.is_organizer,
    rsvp: row.rsvp,
    status: row.status,
    travelMode: row.travel_mode,
    trackingSource: row.tracking_source,
    sharing: row.sharing,
    selfReportedEta: row.self_reported_eta?.getTime() ?? null,
    arrivedAt: row.arrived_at?.getTime() ?? null,
    lastPosition:
      row.lat !== null && row.lng !== null && row.recorded_at !== null
        ? {
            lat: row.lat,
            lng: row.lng,
            accuracyM: row.accuracy_m ?? 0,
            recordedAt: row.recorded_at.getTime(),
          }
        : null,
    eta:
      row.eta_at !== null && row.eta_computed_at !== null
        ? {
            etaAt: row.eta_at.getTime(),
            distanceM: row.eta_distance_m ?? 0,
            durationS: row.eta_duration_s ?? 0,
            source: row.eta_source ?? 'straight_line',
            computedAt: row.eta_computed_at.getTime(),
          }
        : null,
  };
}

/** FR-1 — create the event and seat the organizer in one transaction. */
export async function createEvent(
  input: CreateEventInput,
): Promise<CreatedEvent> {
  const token = generateEventToken();
  const retention = retentionSchedule(input.startsAt);
  const pinHash = input.pin === undefined ? null : await hashPin(input.pin);
  const session = issueSession();

  return transaction(async (client) => {
    const eventResult = await client.query<EventRow>(
      `insert into events (
         token, pin_hash, title, place_name, place_address, place_lat, place_lng,
         starts_at, timezone, location_purge_at, feed_purge_at, expires_at
       ) values ($1,$2,$3,$4,$5,$6,$7, to_timestamp($8/1000.0), $9,
                 to_timestamp($10/1000.0), to_timestamp($11/1000.0), to_timestamp($12/1000.0))
       returning *`,
      [
        token, pinHash, input.title, input.placeName, input.placeAddress,
        input.lat, input.lng, input.startsAt, input.timezone,
        retention.locationPurgeAt, retention.feedPurgeAt, retention.expiresAt,
      ],
    );
    const eventRow = eventResult.rows[0];
    if (eventRow === undefined) throw new Error('Event insert returned no row');

    // FR-1 — the creator is a participant with RSVP=going, not a special case.
    const participantResult = await client.query<{ id: string }>(
      `insert into participants
         (event_id, display_name, color, is_organizer, rsvp, device_token_hash)
       values ($1, $2, $3, true, 'going', $4)
       returning id`,
      [eventRow.id, input.organizerName, colorFor(0), session.hash],
    );
    const participantId = participantResult.rows[0]?.id;
    if (participantId === undefined) {
      throw new Error('Participant insert returned no row');
    }

    await client.query(
      `insert into messages (event_id, participant_id, kind, meta)
       values ($1, $2, 'joined', $3)`,
      [eventRow.id, participantId, JSON.stringify({ organizer: true })],
    );

    return { event: toEventRecord(eventRow), participantId, session };
  });
}

export async function findEventByToken(
  token: string,
): Promise<EventRecord | null> {
  const row = await queryOne<EventRow>(
    'select * from events where token = $1',
    [token],
  );
  return row === null ? null : toEventRecord(row);
}

/** Internal: the PIN hash never leaves the server, so it has its own accessor. */
export async function findEventPinHash(token: string): Promise<string | null> {
  const row = await queryOne<{ pin_hash: string | null }>(
    'select pin_hash from events where token = $1',
    [token],
  );
  return row?.pin_hash ?? null;
}

/**
 * The roster, with each participant's newest position and current ETA folded in
 * — one query, because the live view reads this constantly.
 */
export async function listParticipants(
  eventId: string,
): Promise<Participant[]> {
  const rows = await query<ParticipantRow>(
    `select p.id, p.display_name, p.color, p.is_organizer, p.rsvp, p.status,
            p.travel_mode, p.tracking_source, p.sharing, p.self_reported_eta,
            p.arrived_at,
            lp.lat, lp.lng, lp.accuracy_m, lp.recorded_at,
            e.eta_at, e.distance_m as eta_distance_m, e.duration_s as eta_duration_s,
            e.source as eta_source, e.computed_at as eta_computed_at
       from participants p
       left join latest_positions lp on lp.participant_id = p.id
       left join etas e on e.participant_id = p.id
      where p.event_id = $1
      order by p.created_at asc`,
    [eventId],
  );
  return rows.map(toParticipant);
}

export async function findParticipantBySession(
  eventId: string,
  sessionHash: string,
): Promise<Participant | null> {
  const row = await queryOne<ParticipantRow>(
    `select p.id, p.display_name, p.color, p.is_organizer, p.rsvp, p.status,
            p.travel_mode, p.tracking_source, p.sharing, p.self_reported_eta,
            p.arrived_at,
            lp.lat, lp.lng, lp.accuracy_m, lp.recorded_at,
            e.eta_at, e.distance_m as eta_distance_m, e.duration_s as eta_duration_s,
            e.source as eta_source, e.computed_at as eta_computed_at
       from participants p
       left join latest_positions lp on lp.participant_id = p.id
       left join etas e on e.participant_id = p.id
      where p.event_id = $1 and p.device_token_hash = $2`,
    [eventId, sessionHash],
  );
  return row === null ? null : toParticipant(row);
}

export interface JoinResult {
  participant: Participant;
  session: IssuedSession | null;
  rejoined: boolean;
}

/**
 * FR-2 — join, or restore an existing membership.
 *
 * Returning to the link on the same device must not create a second you, so an
 * existing session hash short-circuits. The participant cap is enforced inside
 * the transaction: checking first and inserting after is a race that seats 21
 * people.
 */
export async function joinEvent(args: {
  eventId: string;
  displayName: string;
  existingSessionSecretHash: string | null;
}): Promise<JoinResult> {
  const { eventId, displayName, existingSessionSecretHash } = args;

  if (existingSessionSecretHash !== null) {
    const existing = await findParticipantBySession(
      eventId,
      existingSessionSecretHash,
    );
    if (existing !== null) {
      return { participant: existing, session: null, rejoined: true };
    }
  }

  const session = issueSession();

  return transaction(async (client) => {
    // Lock the event row so concurrent joins serialise behind it.
    const locked = await client.query<{ id: string }>(
      'select id from events where id = $1 for update',
      [eventId],
    );
    if (locked.rows[0] === undefined) throw notFound();

    const countResult = await client.query<{ count: string }>(
      'select count(*)::text as count from participants where event_id = $1',
      [eventId],
    );
    const seat = Number(countResult.rows[0]?.count ?? '0');
    if (seat >= MAX_PARTICIPANTS) {
      throw conflict(
        `This event is full (${MAX_PARTICIPANTS} people).`,
        'event_full',
      );
    }

    const inserted = await client.query<{ id: string }>(
      `insert into participants
         (event_id, display_name, color, device_token_hash)
       values ($1, $2, $3, $4)
       returning id`,
      [eventId, displayName.slice(0, DISPLAY_NAME_MAX), colorFor(seat), session.hash],
    );
    const id = inserted.rows[0]?.id;
    if (id === undefined) throw new Error('Participant insert returned no row');

    await client.query(
      `insert into messages (event_id, participant_id, kind) values ($1, $2, 'joined')`,
      [eventId, id],
    );

    const participant = await client.query<ParticipantRow>(
      `select p.id, p.display_name, p.color, p.is_organizer, p.rsvp, p.status,
              p.travel_mode, p.tracking_source, p.sharing, p.self_reported_eta,
              p.arrived_at,
              null::double precision as lat, null::double precision as lng,
              null::real as accuracy_m, null::timestamptz as recorded_at,
              null::timestamptz as eta_at, null::integer as eta_distance_m,
              null::integer as eta_duration_s, null::eta_source as eta_source,
              null::timestamptz as eta_computed_at
         from participants p where p.id = $1`,
      [id],
    );
    const row = participant.rows[0];
    if (row === undefined) throw new Error('Participant read-back failed');

    return { participant: toParticipant(row), session, rejoined: false };
  });
}

export interface UpdateParticipantInput {
  rsvp?: Rsvp | undefined;
  displayName?: string | undefined;
  travelMode?: TravelMode | undefined;
}

/** FR-3 — RSVP and profile changes. Location changes land in R1.2. */
export async function updateParticipant(
  participantId: string,
  input: UpdateParticipantInput,
): Promise<Participant> {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.rsvp !== undefined) {
    sets.push(`rsvp = $${params.push(input.rsvp)}`);
  }
  if (input.displayName !== undefined) {
    sets.push(`display_name = $${params.push(input.displayName)}`);
  }
  if (input.travelMode !== undefined) {
    sets.push(`travel_mode = $${params.push(input.travelMode)}`);
  }
  if (sets.length === 0) {
    const current = await queryOne<{ event_id: string }>(
      'select event_id from participants where id = $1',
      [participantId],
    );
    if (current === null) throw notFound();
    const roster = await listParticipants(current.event_id);
    const me = roster.find((p) => p.id === participantId);
    if (me === undefined) throw notFound();
    return me;
  }

  const updated = await queryOne<{ event_id: string }>(
    `update participants set ${sets.join(', ')}
      where id = $${params.push(participantId)} returning event_id`,
    params,
  );
  if (updated === null) throw notFound();

  const roster = await listParticipants(updated.event_id);
  const me = roster.find((p) => p.id === participantId);
  if (me === undefined) throw notFound();
  return me;
}

export async function leaveEvent(participantId: string): Promise<void> {
  await query('delete from participants where id = $1', [participantId]);
}
