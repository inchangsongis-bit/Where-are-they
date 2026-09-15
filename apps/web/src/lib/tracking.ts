import {
  CHECKIN_CLOSES_AFTER_MS, evaluateArrival, isCheckinOpen, roundPosition,
  shouldRecomputeEta,
  type LatLng, type Position, type TrackingSource, type TravelMode,
} from '@wat/core';
import { query, queryOne, transaction } from './db';
import { conflict } from './errors';
import { getRoutingProvider } from './routing';
import type { EventRecord } from './events';

/**
 * FR-9/FR-11/FR-14 — the position ingest path.
 *
 * A note on the throttle. `shouldSendPosition` in packages/core is a *client*
 * rule: don't burn battery and data sending fixes that say nothing new. The
 * server deliberately does not re-apply it as an acceptance filter, because
 * both of its conditions must hold — and someone stuck in traffic satisfies the
 * time condition while failing the distance one. Dropping their updates would
 * make a phone that is working perfectly appear to go stale. The server's job
 * is a rate limit (PS-7), not a redundant second opinion.
 */

interface TrackingRow {
  arrival_dwell_since: Date | null;
  status: 'not_started' | 'en_route' | 'arrived';
  travel_mode: TravelMode;
  eta_computed_at: Date | null;
  eta_from_lat: number | null;
  eta_from_lng: number | null;
}

export interface IngestResult {
  accepted: number;
  arrived: boolean;
  etaComputed: boolean;
}

async function trackingState(participantId: string): Promise<TrackingRow | null> {
  return queryOne<TrackingRow>(
    `select p.arrival_dwell_since, p.status, p.travel_mode,
            e.computed_at as eta_computed_at,
            e.computed_from_lat as eta_from_lat,
            e.computed_from_lng as eta_from_lng
       from participants p
       left join etas e on e.participant_id = p.id
      where p.id = $1`,
    [participantId],
  );
}

/**
 * Accepts one or more positions (a batch arrives when an offline queue flushes)
 * and advances arrival and ETA from the newest one.
 */
export async function recordPositions(args: {
  participantId: string;
  event: EventRecord;
  positions: readonly Position[];
  source: TrackingSource;
  now?: number;
}): Promise<IngestResult> {
  const { participantId, event, source } = args;
  const now = args.now ?? Date.now();

  if (event.status === 'cancelled') {
    throw conflict('This event was cancelled.', 'event_cancelled');
  }

  // PS-2 — the client is supposed to stop tracking when the event window
  // closes, and the server does not take its word for it. A phone with a stuck
  // background task must not be able to keep reporting someone's position to a
  // group that stopped caring hours ago.
  if (now > event.startsAt + CHECKIN_CLOSES_AFTER_MS) {
    throw conflict('This event is over.', 'event_over');
  }

  const state = await trackingState(participantId);
  if (state === null) throw conflict('Not in this event.', 'not_joined');

  // FR-14 — arrival is sticky. Once someone is in, further fixes are noise and
  // a tracking task that keeps running after arrival is a bug with real-world
  // consequences (PS-2).
  if (state.status === 'arrived') {
    return { accepted: 0, arrived: true, etaComputed: false };
  }

  // Oldest first, so a flushed offline queue replays in the order it happened.
  const ordered = [...args.positions].sort((a, b) => a.recordedAt - b.recordedAt);
  const newest = ordered[ordered.length - 1];
  if (newest === undefined) {
    return { accepted: 0, arrived: false, etaComputed: false };
  }

  const venue: LatLng = { lat: event.venue.lat, lng: event.venue.lng };

  // Replay dwell across the whole batch: a queue that flushes after someone sat
  // outside the restaurant for five minutes should still see the arrival.
  let dwellSince = state.arrival_dwell_since?.getTime() ?? null;
  let arrived = false;
  for (const position of ordered) {
    const evaluated = evaluateArrival({
      insideSince: dwellSince, position, venue, now: position.recordedAt,
    });
    dwellSince = evaluated.insideSince;
    if (evaluated.arrived) {
      arrived = true;
      break;
    }
  }

  const rounded = ordered.map(roundPosition); // PS-8

  await transaction(async (client) => {
    for (const position of rounded) {
      await client.query(
        `insert into positions (participant_id, lat, lng, accuracy_m, recorded_at)
         values ($1, $2, $3, $4, to_timestamp($5/1000.0))`,
        [participantId, position.lat, position.lng, position.accuracyM, position.recordedAt],
      );
    }

    if (arrived) {
      await client.query(
        `update participants
            set status = 'arrived', arrived_at = now(), sharing = false,
                arrival_dwell_since = null, tracking_source = $2
          where id = $1`,
        [participantId, source],
      );
      await client.query(
        `insert into messages (event_id, participant_id, kind) values ($1, $2, 'arrived')`,
        [event.id, participantId],
      );
      // PS-2/PS-3 — sharing stops itself, and the ETA has nothing left to say.
      await client.query('delete from etas where participant_id = $1', [participantId]);
    } else {
      await client.query(
        `update participants
            set arrival_dwell_since = case when $2::bigint is null then null
                                           else to_timestamp($2/1000.0) end,
                tracking_source = $3,
                status = case when status = 'not_started' then 'en_route' else status end,
                sharing = true
          where id = $1`,
        [participantId, dwellSince, source],
      );
    }
  });

  let etaComputed = false;
  if (!arrived) {
    etaComputed = await maybeComputeEta({
      participantId,
      venue,
      from: rounded[rounded.length - 1] as Position,
      mode: state.travel_mode,
      lastComputedAt: state.eta_computed_at?.getTime() ?? null,
      lastComputedFrom:
        state.eta_from_lat !== null && state.eta_from_lng !== null
          ? { lat: state.eta_from_lat, lng: state.eta_from_lng }
          : null,
      now,
    });
  }

  return { accepted: rounded.length, arrived, etaComputed };
}

/** FR-11 — respects the recompute limits, because routing is the metered cost. */
async function maybeComputeEta(args: {
  participantId: string;
  venue: LatLng;
  from: LatLng;
  mode: TravelMode;
  lastComputedAt: number | null;
  lastComputedFrom: LatLng | null;
  now: number;
}): Promise<boolean> {
  const due = shouldRecomputeEta({
    lastComputedAt: args.lastComputedAt,
    lastComputedFrom: args.lastComputedFrom,
    current: args.from,
    now: args.now,
  });
  if (!due) return false;

  const [eta] = await getRoutingProvider().routeMany(
    [{ from: args.from, mode: args.mode }],
    args.venue,
    args.now,
  );
  if (eta === null || eta === undefined) return false;

  await query(
    `insert into etas (participant_id, eta_at, distance_m, duration_s, source,
                       computed_from_lat, computed_from_lng, computed_at)
     values ($1, to_timestamp($2/1000.0), $3, $4, $5, $6, $7, to_timestamp($8/1000.0))
     on conflict (participant_id) do update
       set eta_at = excluded.eta_at, distance_m = excluded.distance_m,
           duration_s = excluded.duration_s, source = excluded.source,
           computed_from_lat = excluded.computed_from_lat,
           computed_from_lng = excluded.computed_from_lng,
           computed_at = excluded.computed_at`,
    [
      args.participantId, eta.etaAt, eta.distanceM, eta.durationS, eta.source,
      args.from.lat, args.from.lng, eta.computedAt,
    ],
  );
  return true;
}

/** FR-9 — check in, stop sharing, or mark yourself here. */
export async function setCheckinState(args: {
  participantId: string;
  event: EventRecord;
  status?: 'not_started' | 'en_route' | 'arrived' | undefined;
  sharing?: boolean | undefined;
  selfReportedEta?: number | null | undefined;
  source?: TrackingSource | undefined;
  now?: number;
}): Promise<void> {
  const now = args.now ?? Date.now();

  if (args.status === 'en_route' && !isCheckinOpen(args.event.startsAt, now)) {
    throw conflict(
      'Check-in opens two hours before the event.',
      'checkin_closed',
    );
  }

  const sets: string[] = [];
  const params: unknown[] = [];

  if (args.status !== undefined) {
    sets.push(`status = $${params.push(args.status)}`);
    // FR-14 — status and timestamp move together; the schema enforces it too.
    sets.push(
      args.status === 'arrived'
        ? 'arrived_at = coalesce(arrived_at, now())'
        : 'arrived_at = null',
    );
    if (args.status === 'arrived') {
      sets.push('sharing = false', 'arrival_dwell_since = null');
    }
  }
  if (args.sharing !== undefined && args.status !== 'arrived') {
    sets.push(`sharing = $${params.push(args.sharing)}`);
  }
  if (args.selfReportedEta !== undefined) {
    sets.push(
      args.selfReportedEta === null
        ? 'self_reported_eta = null'
        : `self_reported_eta = to_timestamp($${params.push(args.selfReportedEta)}/1000.0)`,
    );
  }
  if (args.source !== undefined) {
    sets.push(`tracking_source = $${params.push(args.source)}`);
  }
  if (sets.length === 0) return;

  await query(
    `update participants set ${sets.join(', ')} where id = $${params.push(args.participantId)}`,
    params,
  );

  if (args.status === 'arrived') {
    await query('delete from etas where participant_id = $1', [args.participantId]);
    await query(
      `insert into messages (event_id, participant_id, kind) values ($1, $2, 'arrived')`,
      [args.event.id, args.participantId],
    );
  }
}
