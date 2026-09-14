import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { MAX_PARTICIPANTS, retentionSchedule } from '@wat/core';
import { closePool, queryOne } from './db';
import {
  createEvent, findEventByToken, findParticipantBySession, joinEvent,
  leaveEvent, listParticipants, updateParticipant,
} from './events';
import { issueSession } from './session';
import { verifyPin } from './pin';
import { KISA, applyMigrations, describeWithDb, resetData } from './test-db';

const START = Date.now() + 60 * 60_000;

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Dinner at Kisa',
    placeName: KISA.placeName,
    placeAddress: KISA.placeAddress,
    lat: KISA.lat,
    lng: KISA.lng,
    startsAt: START,
    timezone: KISA.timezone,
    organizerName: 'Ana',
    ...overrides,
  } as Parameters<typeof createEvent>[0];
}

describeWithDb('events repository', () => {
  beforeAll(applyMigrations);
  beforeEach(resetData);
  afterAll(closePool);

  it('creates an event and seats the organizer as going', async () => {
    const created = await createEvent(baseInput());

    expect(created.event.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(created.event.hasPin).toBe(false);

    const roster = await listParticipants(created.event.id);
    expect(roster).toHaveLength(1);
    expect(roster[0]?.displayName).toBe('Ana');
    expect(roster[0]?.isOrganizer).toBe(true);
    expect(roster[0]?.rsvp).toBe('going');
  });

  it('stores the three retention clocks from the shared rule', async () => {
    const created = await createEvent(baseInput());
    const expected = retentionSchedule(START);

    const row = await queryOne<{
      location_purge_at: Date; feed_purge_at: Date; expires_at: Date;
    }>(
      'select location_purge_at, feed_purge_at, expires_at from events where id = $1',
      [created.event.id],
    );

    expect(row?.location_purge_at.getTime()).toBe(expected.locationPurgeAt);
    expect(row?.feed_purge_at.getTime()).toBe(expected.feedPurgeAt);
    expect(row?.expires_at.getTime()).toBe(expected.expiresAt);
  });

  it('hashes the PIN rather than storing it', async () => {
    const created = await createEvent(baseInput({ pin: '4821' }));
    expect(created.event.hasPin).toBe(true);

    const row = await queryOne<{ pin_hash: string }>(
      'select pin_hash from events where id = $1', [created.event.id],
    );
    expect(row?.pin_hash).not.toContain('4821');
    expect(await verifyPin('4821', row?.pin_hash ?? '')).toBe(true);
  });

  it('never stores the session secret, only its hash', async () => {
    const created = await createEvent(baseInput());
    const row = await queryOne<{ device_token_hash: string }>(
      'select device_token_hash from participants where event_id = $1',
      [created.event.id],
    );
    expect(row?.device_token_hash).not.toBe(created.session.secret);
    expect(row?.device_token_hash).toBe(created.session.hash);
  });

  it('writes a joined system event to the feed', async () => {
    const created = await createEvent(baseInput());
    const row = await queryOne<{ kind: string; body: string | null }>(
      'select kind, body from messages where event_id = $1', [created.event.id],
    );
    expect(row?.kind).toBe('joined');
    expect(row?.body).toBeNull();
  });

  it('finds an event by token and not by a near-miss', async () => {
    const created = await createEvent(baseInput());
    expect(await findEventByToken(created.event.token)).not.toBeNull();
    expect(await findEventByToken('AAAAAAAAAAAAAAAAAAAAAA')).toBeNull();
  });

  it('lets a new device join and gives it its own colour', async () => {
    const created = await createEvent(baseInput());
    const joined = await joinEvent({
      eventId: created.event.id,
      displayName: 'Marco',
      existingSessionSecretHash: null,
    });

    expect(joined.rejoined).toBe(false);
    expect(joined.session).not.toBeNull();
    expect(joined.participant.rsvp).toBe('pending');
    expect(joined.participant.color).not.toBe(created.session.hash);

    const roster = await listParticipants(created.event.id);
    expect(roster.map((p) => p.displayName)).toEqual(['Ana', 'Marco']);
    expect(new Set(roster.map((p) => p.color)).size).toBe(2);
  });

  it('restores the same participant when a device returns to the link', async () => {
    const created = await createEvent(baseInput());
    const first = await joinEvent({
      eventId: created.event.id,
      displayName: 'Marco',
      existingSessionSecretHash: null,
    });
    const session = first.session;
    expect(session).not.toBeNull();

    const again = await joinEvent({
      eventId: created.event.id,
      displayName: 'Marco',
      existingSessionSecretHash: session?.hash ?? null,
    });

    expect(again.rejoined).toBe(true);
    expect(again.participant.id).toBe(first.participant.id);
    expect(again.session).toBeNull();
    expect(await listParticipants(created.event.id)).toHaveLength(2);
  });

  it('refuses to seat more than the cap, even under concurrent joins', async () => {
    const created = await createEvent(baseInput());

    // One organizer is already seated; fill the rest at once.
    const attempts = Array.from({ length: MAX_PARTICIPANTS + 4 }, (_, i) =>
      joinEvent({
        eventId: created.event.id,
        displayName: `Guest${i}`,
        existingSessionSecretHash: null,
      }).then(
        () => 'ok' as const,
        () => 'rejected' as const,
      ),
    );
    const results = await Promise.all(attempts);

    expect(results.filter((r) => r === 'ok')).toHaveLength(MAX_PARTICIPANTS - 1);
    expect(await listParticipants(created.event.id)).toHaveLength(MAX_PARTICIPANTS);
  });

  it('looks a participant up by session hash and not by a different one', async () => {
    const created = await createEvent(baseInput());
    const found = await findParticipantBySession(
      created.event.id, created.session.hash,
    );
    expect(found?.displayName).toBe('Ana');

    expect(
      await findParticipantBySession(created.event.id, issueSession().hash),
    ).toBeNull();
  });

  it('updates RSVP, name and travel mode', async () => {
    const created = await createEvent(baseInput());
    const me = (await listParticipants(created.event.id))[0];

    const updated = await updateParticipant(me?.id ?? '', {
      rsvp: 'maybe', displayName: 'Ana K', travelMode: 'transit',
    });

    expect(updated.rsvp).toBe('maybe');
    expect(updated.displayName).toBe('Ana K');
    expect(updated.travelMode).toBe('transit');
  });

  it('returns the participant unchanged when asked to update nothing', async () => {
    const created = await createEvent(baseInput());
    const me = (await listParticipants(created.event.id))[0];
    const updated = await updateParticipant(me?.id ?? '', {});
    expect(updated.displayName).toBe('Ana');
  });

  it('reports no position or ETA for someone who has not shared', async () => {
    const created = await createEvent(baseInput());
    const me = (await listParticipants(created.event.id))[0];
    expect(me?.lastPosition).toBeNull();
    expect(me?.eta).toBeNull();
  });

  it('removes a participant on leave, and their feed authorship survives', async () => {
    const created = await createEvent(baseInput());
    const joined = await joinEvent({
      eventId: created.event.id, displayName: 'Marco',
      existingSessionSecretHash: null,
    });

    await leaveEvent(joined.participant.id);

    expect(await listParticipants(created.event.id)).toHaveLength(1);
    // The message row stays, with its author nulled — the feed is a record of
    // what happened, not a list of who is currently present.
    const messages = await queryOne<{ count: string }>(
      'select count(*)::text as count from messages where event_id = $1',
      [created.event.id],
    );
    expect(Number(messages?.count)).toBe(2);
  });
});
