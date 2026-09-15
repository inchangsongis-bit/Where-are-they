import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { closePool, query } from './db';
import { sessionCookieName } from './session';
import { KISA, applyMigrations, cookieFrom, describeWithDb, resetData } from './test-db';

import { POST as createEventRoute } from '@/app/api/events/route';
import {
  GET as getEventRoute, PATCH as cancelEventRoute,
} from '@/app/api/events/[token]/route';
import { POST as joinRoute } from '@/app/api/events/[token]/join/route';
import {
  DELETE as leaveRoute, PATCH as patchMeRoute,
} from '@/app/api/events/[token]/me/route';
import { POST as positionRoute } from '@/app/api/events/[token]/me/position/route';
import { GET as getFeedRoute } from '@/app/api/events/[token]/messages/route';

function req(url: string, method: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const params = (token: string) => ({ params: Promise.resolve({ token }) });

describeWithDb('event lifecycle', () => {
  let ip = 0;

  beforeAll(applyMigrations);
  beforeEach(resetData);
  afterAll(closePool);

  async function makeEvent() {
    ip += 1;
    const response = await createEventRoute(
      req('http://t/api/events', 'POST', {
        title: 'Dinner at Kisa',
        placeName: KISA.placeName, placeAddress: KISA.placeAddress,
        lat: KISA.lat, lng: KISA.lng,
        startsAt: new Date(Date.now() + 30 * 60_000).toISOString(),
        timezone: KISA.timezone, organizerName: 'Ana',
      }, { 'x-forwarded-for': `10.50.${ip}.1` }),
    );
    const data = (await response.json()) as { event: { id: string; token: string } };
    const cookie = cookieFrom(response, sessionCookieName(data.event.token)) ?? '';
    return {
      event: data.event,
      header: { cookie: `${sessionCookieName(data.event.token)}=${cookie}` },
    };
  }

  async function addPerson(token: string, name: string) {
    ip += 1;
    const response = await joinRoute(
      req(`http://t/api/events/${token}/join`, 'POST', { displayName: name },
        { 'x-forwarded-for': `10.51.${ip}.1` }),
      params(token),
    );
    const data = (await response.json()) as { participant: { id: string } };
    const cookie = cookieFrom(response, sessionCookieName(token)) ?? '';
    return { id: data.participant.id, header: { cookie: `${sessionCookieName(token)}=${cookie}` } };
  }

  async function snapshot(token: string) {
    const response = await getEventRoute(
      new Request(`http://t/api/events/${token}`), params(token),
    );
    return (await response.json()) as {
      event: { status: string };
      participants: { sharing: boolean; eta: unknown; lastPosition: unknown }[];
    };
  }

  // --- cancelling -----------------------------------------------------------

  it('lets the organizer cancel', async () => {
    const { event, header } = await makeEvent();
    const response = await cancelEventRoute(
      req(`http://t/api/events/${event.token}`, 'PATCH', { status: 'cancelled' }, header),
      params(event.token),
    );
    expect(response.status).toBe(200);
    expect((await snapshot(event.token)).event.status).toBe('cancelled');
  });

  it('refuses to let anyone else cancel a dinner for six', async () => {
    const { event } = await makeEvent();
    const marco = await addPerson(event.token, 'Marco');

    const response = await cancelEventRoute(
      req(`http://t/api/events/${event.token}`, 'PATCH', { status: 'cancelled' },
        marco.header),
      params(event.token),
    );
    expect(response.status).toBe(403);
    expect((await snapshot(event.token)).event.status).toBe('active');
  });

  it('refuses to cancel with no session at all', async () => {
    const { event } = await makeEvent();
    const response = await cancelEventRoute(
      req(`http://t/api/events/${event.token}`, 'PATCH', { status: 'cancelled' }),
      params(event.token),
    );
    expect(response.status).toBe(401);
  });

  it('stops everyone sharing, and deletes the positions', async () => {
    // The point of cancelling: people may be driving across town right now
    // with their location going to a group that is no longer meeting.
    const { event, header } = await makeEvent();
    const marco = await addPerson(event.token, 'Marco');
    await positionRoute(
      req(`http://t/api/events/${event.token}/me/position`, 'POST', {
        lat: 40.7538, lng: -73.9838, accuracyM: 10,
        recordedAt: Date.now(), source: 'web',
      }, marco.header),
      params(event.token),
    );

    const before = await snapshot(event.token);
    expect(before.participants.some((p) => p.sharing)).toBe(true);
    expect(before.participants.some((p) => p.lastPosition !== null)).toBe(true);

    await cancelEventRoute(
      req(`http://t/api/events/${event.token}`, 'PATCH', { status: 'cancelled' }, header),
      params(event.token),
    );

    const after = await snapshot(event.token);
    expect(after.participants.every((p) => !p.sharing)).toBe(true);
    expect(after.participants.every((p) => p.lastPosition === null)).toBe(true);
    expect(after.participants.every((p) => p.eta === null)).toBe(true);
  });

  it('records the cancellation in the thread', async () => {
    const { event, header } = await makeEvent();
    await cancelEventRoute(
      req(`http://t/api/events/${event.token}`, 'PATCH', { status: 'cancelled' }, header),
      params(event.token),
    );

    const feed = await getFeedRoute(
      new Request(`http://t/api/events/${event.token}/messages`), params(event.token),
    );
    const data = (await feed.json()) as { entries: { kind: string; authorName: string }[] };
    const cancelled = data.entries.find((entry) => entry.kind === 'cancelled');
    expect(cancelled?.authorName).toBe('Ana');
  });

  it('refuses new positions once cancelled', async () => {
    const { event, header } = await makeEvent();
    const marco = await addPerson(event.token, 'Marco');
    await cancelEventRoute(
      req(`http://t/api/events/${event.token}`, 'PATCH', { status: 'cancelled' }, header),
      params(event.token),
    );

    const response = await positionRoute(
      req(`http://t/api/events/${event.token}/me/position`, 'POST', {
        lat: 40.75, lng: -73.98, accuracyM: 10,
        recordedAt: Date.now(), source: 'web',
      }, marco.header),
      params(event.token),
    );
    expect(response.status).toBe(409);
  });

  it('refuses new joins once cancelled', async () => {
    const { event, header } = await makeEvent();
    await cancelEventRoute(
      req(`http://t/api/events/${event.token}`, 'PATCH', { status: 'cancelled' }, header),
      params(event.token),
    );

    ip += 1;
    const response = await joinRoute(
      req(`http://t/api/events/${event.token}/join`, 'POST', { displayName: 'Late' },
        { 'x-forwarded-for': `10.52.${ip}.1` }),
      params(event.token),
    );
    expect(response.status).toBe(409);
  });

  it('is idempotent', async () => {
    const { event, header } = await makeEvent();
    for (let i = 0; i < 2; i += 1) {
      const response = await cancelEventRoute(
        req(`http://t/api/events/${event.token}`, 'PATCH', { status: 'cancelled' }, header),
        params(event.token),
      );
      expect(response.status).toBe(200);
    }
    const rows = await query<{ count: string }>(
      `select count(*)::text as count from messages
        where event_id = $1 and kind = 'cancelled'`, [event.id],
    );
    expect(Number(rows[0]?.count)).toBe(1);
  });

  it('will not accept an arbitrary status change', async () => {
    const { event, header } = await makeEvent();
    const response = await cancelEventRoute(
      req(`http://t/api/events/${event.token}`, 'PATCH', { status: 'active' }, header),
      params(event.token),
    );
    expect(response.status).toBe(409);
  });

  // --- leaving --------------------------------------------------------------

  it('removes someone who leaves, and stops their sharing', async () => {
    const { event } = await makeEvent();
    const marco = await addPerson(event.token, 'Marco');
    await positionRoute(
      req(`http://t/api/events/${event.token}/me/position`, 'POST', {
        lat: 40.7538, lng: -73.9838, accuracyM: 10,
        recordedAt: Date.now(), source: 'web',
      }, marco.header),
      params(event.token),
    );

    const response = await leaveRoute(
      req(`http://t/api/events/${event.token}/me`, 'DELETE', undefined, marco.header),
      params(event.token),
    );
    expect(response.status).toBe(200);

    const after = await snapshot(event.token);
    expect(after.participants).toHaveLength(1);

    // PS-3 — their positions go with them.
    const positions = await query<{ count: string }>(
      `select count(*)::text as count from positions
        where participant_id = $1`, [marco.id],
    );
    expect(Number(positions[0]?.count)).toBe(0);
  });

  it('leaves their words in the thread, attributed', async () => {
    const { event } = await makeEvent();
    const marco = await addPerson(event.token, 'Marco');
    await leaveRoute(
      req(`http://t/api/events/${event.token}/me`, 'DELETE', undefined, marco.header),
      params(event.token),
    );

    const feed = await getFeedRoute(
      new Request(`http://t/api/events/${event.token}/messages`), params(event.token),
    );
    const data = (await feed.json()) as {
      entries: { kind: string; authorName: string | null }[];
    };
    expect(data.entries.some((e) => e.kind === 'joined' && e.authorName === 'Marco'))
      .toBe(true);
  });

  it('lets someone who left join again as a new participant', async () => {
    const { event } = await makeEvent();
    const marco = await addPerson(event.token, 'Marco');
    await leaveRoute(
      req(`http://t/api/events/${event.token}/me`, 'DELETE', undefined, marco.header),
      params(event.token),
    );

    ip += 1;
    const rejoin = await joinRoute(
      req(`http://t/api/events/${event.token}/join`, 'POST', { displayName: 'Marco' },
        { 'x-forwarded-for': `10.53.${ip}.1`, ...marco.header }),
      params(event.token),
    );
    expect(rejoin.status).toBe(201);
    expect((await snapshot(event.token)).participants).toHaveLength(2);
  });

  it('refuses actions from a session that has left', async () => {
    const { event } = await makeEvent();
    const marco = await addPerson(event.token, 'Marco');
    await leaveRoute(
      req(`http://t/api/events/${event.token}/me`, 'DELETE', undefined, marco.header),
      params(event.token),
    );

    const response = await patchMeRoute(
      req(`http://t/api/events/${event.token}/me`, 'PATCH', { rsvp: 'going' }, marco.header),
      params(event.token),
    );
    expect(response.status).toBe(401);
  });
});
