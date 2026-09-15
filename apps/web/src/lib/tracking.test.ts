import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  ARRIVAL_DWELL_MS, POSITION_EXPIRED_AFTER_MS, arrivalDisplay,
  type Position, type TravelMode,
} from '@wat/core';
import { closePool, query, queryOne } from './db';
import { createEvent, listParticipants, type EventRecord } from './events';
import { StraightLineRouting, setRoutingProvider, type RoutingProvider } from './routing';
import { recordPositions, setCheckinState } from './tracking';
import { KISA, applyMigrations, describeWithDb, resetData } from './test-db';

const VENUE = { lat: KISA.lat, lng: KISA.lng };
const AT_DOOR = { lat: KISA.lat + 0.0002, lng: KISA.lng };
const FAR = { lat: 40.7538, lng: -73.9838 }; // ~4km north

function position(at: { lat: number; lng: number }, recordedAt: number): Position {
  return { ...at, accuracyM: 12, recordedAt };
}

/** Counts calls so the recompute limits can be asserted, not assumed. */
class CountingRouting implements RoutingProvider {
  readonly name = 'counting';
  calls = 0;
  private readonly inner = new StraightLineRouting();
  routeMany(...args: Parameters<RoutingProvider['routeMany']>) {
    this.calls += 1;
    return this.inner.routeMany(...args);
  }
}

describeWithDb('position ingest', () => {
  let routing: CountingRouting;

  beforeAll(applyMigrations);
  beforeEach(async () => {
    await resetData();
    routing = new CountingRouting();
    setRoutingProvider(routing);
  });
  afterEach(() => setRoutingProvider(undefined));
  afterAll(closePool);

  async function makeEvent(startsAt = Date.now() + 30 * 60_000) {
    const created = await createEvent({
      title: 'Dinner at Kisa',
      placeName: KISA.placeName, placeAddress: KISA.placeAddress,
      lat: KISA.lat, lng: KISA.lng, startsAt, timezone: KISA.timezone,
      organizerName: 'Ana',
    });
    return { event: created.event, participantId: created.participantId };
  }

  async function me(event: EventRecord, id: string) {
    const roster = await listParticipants(event.id);
    const found = roster.find((p) => p.id === id);
    if (found === undefined) throw new Error('participant vanished');
    return found;
  }

  it('records a fix, checks the person in, and computes an ETA', async () => {
    const { event, participantId } = await makeEvent();
    const now = Date.now();

    const result = await recordPositions({
      participantId, event, positions: [position(FAR, now)], source: 'web', now,
    });

    expect(result.accepted).toBe(1);
    expect(result.arrived).toBe(false);
    expect(result.etaComputed).toBe(true);

    const participant = await me(event, participantId);
    expect(participant.status).toBe('en_route');
    expect(participant.sharing).toBe(true);
    expect(participant.lastPosition).not.toBeNull();
    expect(participant.eta?.etaAt).toBeGreaterThan(now);
  });

  it('rounds stored coordinates to five decimals (PS-8)', async () => {
    const { event, participantId } = await makeEvent();
    await recordPositions({
      participantId, event, source: 'web',
      positions: [position({ lat: 40.75381234567, lng: -73.98387654321 }, Date.now())],
    });

    const row = await queryOne<{ lat: number; lng: number }>(
      'select lat, lng from positions where participant_id = $1', [participantId],
    );
    expect(row?.lat).toBe(40.75381);
    expect(row?.lng).toBe(-73.98388);
  });

  it('keeps accepting fixes from someone stuck in traffic', async () => {
    // The client throttle needs time AND distance. The server must not reuse it
    // as a filter: a stationary phone is still a working phone, and dropping
    // its updates would make it look like it had gone dark.
    const { event, participantId } = await makeEvent();
    const start = Date.now();

    await recordPositions({
      participantId, event, source: 'web',
      positions: [position(FAR, start)], now: start,
    });

    const muchLater = start + 6 * 60_000;
    await recordPositions({
      participantId, event, source: 'web',
      // Moved three metres in six minutes.
      positions: [position({ lat: FAR.lat + 0.00003, lng: FAR.lng }, muchLater)],
      now: muchLater,
    });

    const participant = await me(event, participantId);
    expect(participant.lastPosition?.recordedAt).toBe(muchLater);
    expect(arrivalDisplay(participant, muchLater).kind).toBe('eta');
  });

  it('respects the ETA recompute limits, because routing is the metered cost', async () => {
    const { event, participantId } = await makeEvent();
    const start = Date.now();

    await recordPositions({
      participantId, event, source: 'web', positions: [position(FAR, start)], now: start,
    });
    expect(routing.calls).toBe(1);

    // Soon after, barely moved: no second call.
    const soon = start + 10_000;
    await recordPositions({
      participantId, event, source: 'web',
      positions: [position({ lat: FAR.lat + 0.0001, lng: FAR.lng }, soon)], now: soon,
    });
    expect(routing.calls).toBe(1);

    // Past the interval: recompute.
    const later = start + 60_000;
    await recordPositions({
      participantId, event, source: 'web',
      positions: [position({ lat: FAR.lat + 0.0002, lng: FAR.lng }, later)], now: later,
    });
    expect(routing.calls).toBe(2);
  });

  it('recomputes early when someone has covered real ground', async () => {
    const { event, participantId } = await makeEvent();
    const start = Date.now();
    await recordPositions({
      participantId, event, source: 'web', positions: [position(FAR, start)], now: start,
    });

    const soon = start + 5_000;
    await recordPositions({
      participantId, event, source: 'web',
      positions: [position({ lat: FAR.lat - 0.006, lng: FAR.lng }, soon)], now: soon,
    });
    expect(routing.calls).toBe(2);
  });

  it('does not arrive on proximity alone', async () => {
    const { event, participantId } = await makeEvent();
    const now = Date.now();

    const result = await recordPositions({
      participantId, event, source: 'web', positions: [position(AT_DOOR, now)], now,
    });

    expect(result.arrived).toBe(false);
    expect((await me(event, participantId)).status).toBe('en_route');
  });

  it('arrives after dwelling inside the geofence', async () => {
    const { event, participantId } = await makeEvent();
    const start = Date.now();

    await recordPositions({
      participantId, event, source: 'web', positions: [position(AT_DOOR, start)], now: start,
    });

    const after = start + ARRIVAL_DWELL_MS + 1_000;
    const result = await recordPositions({
      participantId, event, source: 'web', positions: [position(AT_DOOR, after)], now: after,
    });

    expect(result.arrived).toBe(true);
    const participant = await me(event, participantId);
    expect(participant.status).toBe('arrived');
    expect(participant.arrivedAt).not.toBeNull();
    // PS-2 — sharing stops itself, and the ETA has nothing left to say.
    expect(participant.sharing).toBe(false);
    expect(participant.eta).toBeNull();
  });

  it('does not arrive for someone who drove past the door', async () => {
    const { event, participantId } = await makeEvent();
    const start = Date.now();

    await recordPositions({
      participantId, event, source: 'web', positions: [position(AT_DOOR, start)], now: start,
    });
    // Gone again well before the dwell completes.
    const passing = start + 20_000;
    await recordPositions({
      participantId, event, source: 'web', positions: [position(FAR, passing)], now: passing,
    });
    // Back at the door, but the clock restarted.
    const back = start + ARRIVAL_DWELL_MS + 5_000;
    const result = await recordPositions({
      participantId, event, source: 'web', positions: [position(AT_DOOR, back)], now: back,
    });

    expect(result.arrived).toBe(false);
  });

  it('replays a flushed offline batch and still sees the arrival', async () => {
    const { event, participantId } = await makeEvent();
    const start = Date.now() - 10 * 60_000;

    const result = await recordPositions({
      participantId, event, source: 'app_foreground',
      positions: [
        position(FAR, start),
        position(AT_DOOR, start + 5 * 60_000),
        position(AT_DOOR, start + 5 * 60_000 + ARRIVAL_DWELL_MS + 1_000),
      ],
    });

    expect(result.accepted).toBe(3);
    expect(result.arrived).toBe(true);
    expect((await me(event, participantId)).status).toBe('arrived');
  });

  it('ignores further fixes once someone has arrived — arrival is sticky', async () => {
    const { event, participantId } = await makeEvent();
    const start = Date.now();
    await recordPositions({
      participantId, event, source: 'web', positions: [position(AT_DOOR, start)], now: start,
    });
    const after = start + ARRIVAL_DWELL_MS + 1_000;
    await recordPositions({
      participantId, event, source: 'web', positions: [position(AT_DOOR, after)], now: after,
    });

    const later = after + 60_000;
    const result = await recordPositions({
      participantId, event, source: 'web', positions: [position(FAR, later)], now: later,
    });

    expect(result.accepted).toBe(0);
    expect(result.arrived).toBe(true);
    expect((await me(event, participantId)).status).toBe('arrived');
  });

  it('writes an arrived event to the feed exactly once', async () => {
    const { event, participantId } = await makeEvent();
    const start = Date.now();
    await recordPositions({
      participantId, event, source: 'web', positions: [position(AT_DOOR, start)], now: start,
    });
    const after = start + ARRIVAL_DWELL_MS + 1_000;
    await recordPositions({
      participantId, event, source: 'web', positions: [position(AT_DOOR, after)], now: after,
    });
    await recordPositions({
      participantId, event, source: 'web',
      positions: [position(AT_DOOR, after + 60_000)], now: after + 60_000,
    });

    const rows = await query<{ count: string }>(
      `select count(*)::text as count from messages
        where event_id = $1 and kind = 'arrived'`, [event.id],
    );
    expect(Number(rows[0]?.count)).toBe(1);
  });

  it('refuses positions for a cancelled event', async () => {
    const { event, participantId } = await makeEvent();
    await query(`update events set status = 'cancelled' where id = $1`, [event.id]);
    const cancelled = { ...event, status: 'cancelled' as const };

    await expect(
      recordPositions({
        participantId, event: cancelled, source: 'web',
        positions: [position(FAR, Date.now())],
      }),
    ).rejects.toThrow(/cancelled/i);
  });

  it('shows a stale position honestly rather than as a live ETA', async () => {
    const { event, participantId } = await makeEvent();
    const long_ago = Date.now() - POSITION_EXPIRED_AFTER_MS - 60_000;

    await recordPositions({
      participantId, event, source: 'web',
      positions: [position(FAR, long_ago)], now: long_ago,
    });

    const participant = await me(event, participantId);
    expect(arrivalDisplay(participant, Date.now()).kind).toBe('last_seen');
  });
});

describeWithDb('check-in state', () => {
  beforeAll(applyMigrations);
  beforeEach(resetData);
  afterAll(closePool);

  async function makeEvent(startsAt: number) {
    const created = await createEvent({
      title: 'Dinner', placeName: KISA.placeName, placeAddress: KISA.placeAddress,
      lat: KISA.lat, lng: KISA.lng, startsAt, timezone: KISA.timezone,
      organizerName: 'Ana',
    });
    return created;
  }

  it('lets someone mark themselves here without any location at all', async () => {
    const created = await makeEvent(Date.now() + 30 * 60_000);
    await setCheckinState({
      participantId: created.participantId, event: created.event, status: 'arrived',
    });

    const roster = await listParticipants(created.event.id);
    expect(roster[0]?.status).toBe('arrived');
    expect(roster[0]?.arrivedAt).not.toBeNull();
  });

  it('accepts a self-reported ETA when location is refused', async () => {
    const created = await makeEvent(Date.now() + 30 * 60_000);
    const eta = Date.now() + 20 * 60_000;

    await setCheckinState({
      participantId: created.participantId, event: created.event,
      status: 'en_route', sharing: false, selfReportedEta: eta, source: 'manual',
    });

    const roster = await listParticipants(created.event.id);
    expect(roster[0]?.status).toBe('en_route');
    expect(roster[0]?.sharing).toBe(false);
    expect(roster[0]?.trackingSource).toBe('manual');
    expect(arrivalDisplay(roster[0]!, Date.now())).toEqual({
      kind: 'self_reported', at: eta,
    });
  });

  it('refuses check-in outside the window (FR-9)', async () => {
    const created = await makeEvent(Date.now() + 5 * 60 * 60_000);
    await expect(
      setCheckinState({
        participantId: created.participantId, event: created.event, status: 'en_route',
      }),
    ).rejects.toThrow(/Check-in opens/);
  });

  it('allows check-in inside the window', async () => {
    const created = await makeEvent(Date.now() + 90 * 60_000);
    await setCheckinState({
      participantId: created.participantId, event: created.event, status: 'en_route',
    });
    const roster = await listParticipants(created.event.id);
    expect(roster[0]?.status).toBe('en_route');
  });

  it('clears the ETA when someone declares themselves here', async () => {
    const created = await makeEvent(Date.now() + 30 * 60_000);
    await recordPositions({
      participantId: created.participantId, event: created.event, source: 'web',
      positions: [position(FAR, Date.now())],
    });
    expect((await listParticipants(created.event.id))[0]?.eta).not.toBeNull();

    await setCheckinState({
      participantId: created.participantId, event: created.event, status: 'arrived',
    });
    expect((await listParticipants(created.event.id))[0]?.eta).toBeNull();
  });
});
