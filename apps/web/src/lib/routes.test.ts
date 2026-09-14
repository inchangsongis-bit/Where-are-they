import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { closePool } from './db';
import { sessionCookieName } from './session';
import {
  KISA, applyMigrations, cookieFrom, describeWithDb, resetData,
} from './test-db';

import { POST as createEventRoute } from '@/app/api/events/route';
import { GET as getEventRoute } from '@/app/api/events/[token]/route';
import { POST as joinRoute } from '@/app/api/events/[token]/join/route';
import { PATCH as patchMeRoute, DELETE as leaveRoute } from '@/app/api/events/[token]/me/route';
import { POST as verifyPinRoute } from '@/app/api/events/[token]/verify-pin/route';
import { POST as purgeRoute } from '@/app/api/cron/purge/route';

const START = new Date(Date.now() + 60 * 60_000).toISOString();

function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function params(token: string) {
  return { params: Promise.resolve({ token }) };
}

function validEventBody(overrides: Record<string, unknown> = {}) {
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
  };
}

/** Create an event through the route, returning its token and the org's cookie. */
async function createEvent(overrides: Record<string, unknown> = {}, ip = '10.0.0.1') {
  const response = await createEventRoute(
    post('http://t/api/events', validEventBody(overrides), { 'x-forwarded-for': ip }),
  );
  expect(response.status).toBe(201);
  const data = (await response.json()) as { event: { token: string }; inviteUrl: string };
  const cookie = cookieFrom(response, sessionCookieName(data.event.token));
  expect(cookie).not.toBeNull();
  return { token: data.event.token, cookie: cookie ?? '', inviteUrl: data.inviteUrl };
}

describeWithDb('API routes', () => {
  beforeAll(applyMigrations);
  beforeEach(resetData);
  afterAll(closePool);

  // --------------------------------------------------------- create event ---

  it('creates an event, sets an httpOnly cookie, and returns an invite link', async () => {
    const response = await createEventRoute(
      post('http://t/api/events', validEventBody(), { 'x-forwarded-for': '10.0.0.9' }),
    );
    expect(response.status).toBe(201);

    const data = (await response.json()) as { event: { token: string }; inviteUrl: string };
    expect(data.inviteUrl).toContain(`/e/${data.event.token}`);

    const setCookie = response.headers.getSetCookie().join(' ');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
  });

  it.each([
    ['no organizer name', { organizerName: '' }],
    ['no place', { placeName: '' }],
    ['a latitude out of range', { lat: 120 }],
    ['an unparseable date', { startsAt: 'next tuesday-ish' }],
    ['an unknown timezone', { timezone: 'Mars/Olympus_Mons' }],
    ['a three-digit PIN', { pin: '123' }],
  ])('rejects an event with %s', async (_label, overrides) => {
    const response = await createEventRoute(
      post('http://t/api/events', validEventBody(overrides), { 'x-forwarded-for': '10.1.1.1' }),
    );
    expect(response.status).toBe(400);
  });

  it('rejects a body that is not JSON', async () => {
    const response = await createEventRoute(
      new Request('http://t/api/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not json',
      }),
    );
    expect(response.status).toBe(400);
  });

  // ------------------------------------------------------------ read event ---

  it('returns a snapshot without requiring anyone to join', async () => {
    const { token } = await createEvent();
    const response = await getEventRoute(new Request(`http://t/api/events/${token}`), params(token));
    expect(response.status).toBe(200);

    const data = (await response.json()) as {
      event: { title: string }; participants: unknown[];
      summary: { here: number }; me: null; serverTime: number;
    };
    expect(data.event.title).toBe('Dinner at Kisa');
    expect(data.participants).toHaveLength(1);
    expect(data.me).toBeNull();
    expect(data.serverTime).toBeGreaterThan(0);
  });

  it('never exposes the PIN hash in a snapshot', async () => {
    const { token } = await createEvent({ pin: '4821' });
    const response = await getEventRoute(new Request(`http://t/api/events/${token}`), params(token));
    const text = await response.text();
    expect(text).not.toContain('scrypt');
    expect(text).not.toContain('4821');
    expect(text).toContain('"hasPin":true');
  });

  it('identifies the caller when they present their cookie', async () => {
    const { token, cookie } = await createEvent();
    const response = await getEventRoute(
      new Request(`http://t/api/events/${token}`, {
        headers: { cookie: `${sessionCookieName(token)}=${cookie}` },
      }),
      params(token),
    );
    const data = (await response.json()) as { me: { id: string } | null };
    expect(data.me).not.toBeNull();
  });

  it.each([
    ['a malformed token', 'nope'],
    ['a well-formed but unknown token', 'AAAAAAAAAAAAAAAAAAAAAA'],
    ['a path traversal attempt', '../../../etc/passwd'],
  ])('answers 404 for %s, revealing nothing either way', async (_label, token) => {
    const response = await getEventRoute(
      new Request(`http://t/api/events/${token}`), params(token),
    );
    expect(response.status).toBe(404);
    expect((await response.json()) as { code: string }).toMatchObject({ code: 'not_found' });
  });

  // ------------------------------------------------------------------ join ---

  it('joins by name alone and sets a cookie', async () => {
    const { token } = await createEvent();
    const response = await joinRoute(
      post(`http://t/api/events/${token}/join`, { displayName: 'Marco' },
        { 'x-forwarded-for': '10.0.0.2' }),
      params(token),
    );
    expect(response.status).toBe(201);

    const data = (await response.json()) as {
      participant: { displayName: string; rsvp: string }; rejoined: boolean;
    };
    expect(data.participant.displayName).toBe('Marco');
    expect(data.participant.rsvp).toBe('pending');
    expect(data.rejoined).toBe(false);
    expect(cookieFrom(response, sessionCookieName(token))).not.toBeNull();
  });

  it('does not create a second you when you reopen the link', async () => {
    const { token } = await createEvent();
    const first = await joinRoute(
      post(`http://t/api/events/${token}/join`, { displayName: 'Marco' },
        { 'x-forwarded-for': '10.0.0.3' }),
      params(token),
    );
    const cookie = cookieFrom(first, sessionCookieName(token)) ?? '';

    const second = await joinRoute(
      post(`http://t/api/events/${token}/join`, { displayName: 'Marco' },
        { 'x-forwarded-for': '10.0.0.3', cookie: `${sessionCookieName(token)}=${cookie}` }),
      params(token),
    );
    expect(second.status).toBe(200);
    expect((await second.json()) as { rejoined: boolean }).toMatchObject({ rejoined: true });

    const snapshot = await getEventRoute(
      new Request(`http://t/api/events/${token}`), params(token),
    );
    const data = (await snapshot.json()) as { participants: unknown[] };
    expect(data.participants).toHaveLength(2);
  });

  it('disambiguates two people with the same name', async () => {
    const { token } = await createEvent({ organizerName: 'Sam' });
    await joinRoute(
      post(`http://t/api/events/${token}/join`, { displayName: 'Sam' },
        { 'x-forwarded-for': '10.0.0.4' }),
      params(token),
    );

    const snapshot = await getEventRoute(
      new Request(`http://t/api/events/${token}`), params(token),
    );
    const data = (await snapshot.json()) as { participants: { displayName: string }[] };
    const names = data.participants.map((p) => p.displayName);
    expect(names).toContain('Sam');
    expect(names.some((n) => n !== 'Sam' && n.startsWith('Sam'))).toBe(true);
  });

  it('rejects a blank name with a message a person can act on', async () => {
    const { token } = await createEvent();
    const response = await joinRoute(
      post(`http://t/api/events/${token}/join`, { displayName: '   ' },
        { 'x-forwarded-for': '10.0.0.5' }),
      params(token),
    );
    expect(response.status).toBe(400);
    expect((await response.json()) as { error: string }).toMatchObject({
      error: expect.stringMatching(/Enter a name/) as unknown as string,
    });
  });

  it('rate limits joins per IP (PS-7)', async () => {
    const { token } = await createEvent({}, '10.9.9.9');
    const ip = '203.0.113.7';

    const statuses: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const response = await joinRoute(
        post(`http://t/api/events/${token}/join`, { displayName: `Guest${i}` },
          { 'x-forwarded-for': ip }),
        params(token),
      );
      statuses.push(response.status);
    }

    expect(statuses.filter((s) => s === 201)).toHaveLength(10);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------- rsvp / me ---

  it('changes an RSVP for the caller only', async () => {
    const { token, cookie } = await createEvent();
    const response = await patchMeRoute(
      post(`http://t/api/events/${token}/me`, { rsvp: 'maybe' },
        { cookie: `${sessionCookieName(token)}=${cookie}` }),
      params(token),
    );
    expect(response.status).toBe(200);
    expect((await response.json()) as { participant: { rsvp: string } })
      .toMatchObject({ participant: { rsvp: 'maybe' } });
  });

  it('refuses an RSVP change with no cookie', async () => {
    const { token } = await createEvent();
    const response = await patchMeRoute(
      post(`http://t/api/events/${token}/me`, { rsvp: 'going' }), params(token),
    );
    expect(response.status).toBe(401);
  });

  it('refuses an RSVP change with a forged cookie', async () => {
    const { token } = await createEvent();
    const response = await patchMeRoute(
      post(`http://t/api/events/${token}/me`, { rsvp: 'going' },
        { cookie: `${sessionCookieName(token)}=totally-made-up` }),
      params(token),
    );
    expect(response.status).toBe(401);
  });

  it('rejects an RSVP value that is not one of the four', async () => {
    const { token, cookie } = await createEvent();
    const response = await patchMeRoute(
      post(`http://t/api/events/${token}/me`, { rsvp: 'definitely' },
        { cookie: `${sessionCookieName(token)}=${cookie}` }),
      params(token),
    );
    expect(response.status).toBe(400);
  });

  it('rejects a patch that changes nothing', async () => {
    const { token, cookie } = await createEvent();
    const response = await patchMeRoute(
      post(`http://t/api/events/${token}/me`, {},
        { cookie: `${sessionCookieName(token)}=${cookie}` }),
      params(token),
    );
    expect(response.status).toBe(400);
  });

  it('lets someone leave', async () => {
    const { token } = await createEvent();
    const joined = await joinRoute(
      post(`http://t/api/events/${token}/join`, { displayName: 'Marco' },
        { 'x-forwarded-for': '10.0.0.6' }),
      params(token),
    );
    const cookie = cookieFrom(joined, sessionCookieName(token)) ?? '';

    const response = await leaveRoute(
      new Request(`http://t/api/events/${token}/me`, {
        method: 'DELETE', headers: { cookie: `${sessionCookieName(token)}=${cookie}` },
      }),
      params(token),
    );
    expect(response.status).toBe(200);

    const snapshot = await getEventRoute(
      new Request(`http://t/api/events/${token}`), params(token),
    );
    expect((await snapshot.json()) as { participants: unknown[] }).toMatchObject({
      participants: expect.objectContaining({ length: 1 }) as unknown as unknown[],
    });
  });

  // -------------------------------------------------------------------- pin ---

  it('accepts the right PIN and rejects the wrong one', async () => {
    const { token } = await createEvent({ pin: '4821' }, '10.4.4.4');

    const good = await verifyPinRoute(
      post(`http://t/api/events/${token}/verify-pin`, { pin: '4821' },
        { 'x-forwarded-for': '198.51.100.1' }),
      params(token),
    );
    expect(good.status).toBe(200);

    const bad = await verifyPinRoute(
      post(`http://t/api/events/${token}/verify-pin`, { pin: '0000' },
        { 'x-forwarded-for': '198.51.100.2' }),
      params(token),
    );
    expect(bad.status).toBe(403);
  });

  it('rate limits PIN attempts, which is what makes four digits defensible', async () => {
    const { token } = await createEvent({ pin: '4821' }, '10.5.5.5');
    const ip = '198.51.100.99';

    const statuses: number[] = [];
    for (let i = 0; i < 8; i += 1) {
      const response = await verifyPinRoute(
        post(`http://t/api/events/${token}/verify-pin`, { pin: '0000' },
          { 'x-forwarded-for': ip }),
        params(token),
      );
      statuses.push(response.status);
    }

    expect(statuses.filter((s) => s === 403)).toHaveLength(5);
    expect(statuses.filter((s) => s === 429)).toHaveLength(3);
  });

  it('answers the same shape for an event with no PIN, so protection is not detectable', async () => {
    const { token } = await createEvent({}, '10.6.6.6');
    const response = await verifyPinRoute(
      post(`http://t/api/events/${token}/verify-pin`, { pin: '1111' },
        { 'x-forwarded-for': '198.51.100.50' }),
      params(token),
    );
    expect(response.status).toBe(200);
  });

  // ------------------------------------------------------------------ purge ---

  it('refuses to purge without the secret', async () => {
    process.env.CRON_SECRET = 'test-secret';
    const response = await purgeRoute(
      new Request('http://t/api/cron/purge', { method: 'POST' }),
    );
    expect(response.status).toBe(401);
  });

  it('refuses to purge when no secret is configured', async () => {
    delete process.env.CRON_SECRET;
    const response = await purgeRoute(
      new Request('http://t/api/cron/purge', {
        method: 'POST', headers: { authorization: 'Bearer anything' },
      }),
    );
    expect(response.status).toBe(401);
  });

  it('purges with the right secret and reports what it deleted', async () => {
    process.env.CRON_SECRET = 'test-secret';
    await createEvent({}, '10.7.7.7');

    const response = await purgeRoute(
      new Request('http://t/api/cron/purge', {
        method: 'POST', headers: { authorization: 'Bearer test-secret' },
      }),
    );
    expect(response.status).toBe(200);

    const data = (await response.json()) as Record<string, number>;
    expect(data).toHaveProperty('positionsDeleted');
    expect(data).toHaveProperty('eventsDeleted');
    // Nothing is expired yet, so a live event must survive its own purge.
    expect(data['eventsDeleted']).toBe(0);
  });
});
