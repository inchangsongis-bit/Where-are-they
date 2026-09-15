import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { ARRIVAL_DWELL_MS } from '@wat/core';
import { closePool } from './db';
import { sessionCookieName } from './session';
import { StraightLineRouting, setRoutingProvider } from './routing';
import { KISA, applyMigrations, cookieFrom, describeWithDb, resetData } from './test-db';

import { POST as createEventRoute } from '@/app/api/events/route';
import { GET as getEventRoute } from '@/app/api/events/[token]/route';
import { PATCH as patchMeRoute } from '@/app/api/events/[token]/me/route';
import { POST as positionRoute } from '@/app/api/events/[token]/me/position/route';

const AT_DOOR = { lat: KISA.lat + 0.0002, lng: KISA.lng };
const FAR = { lat: 40.7538, lng: -73.9838 };

function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
const params = (token: string) => ({ params: Promise.resolve({ token }) });

describeWithDb('tracking routes', () => {
  beforeAll(applyMigrations);
  beforeEach(async () => {
    await resetData();
    setRoutingProvider(new StraightLineRouting());
  });
  afterEach(() => setRoutingProvider(undefined));
  afterAll(closePool);

  async function makeEvent(minutesFromNow = 30) {
    const response = await createEventRoute(
      post('http://t/api/events', {
        title: 'Dinner at Kisa',
        placeName: KISA.placeName, placeAddress: KISA.placeAddress,
        lat: KISA.lat, lng: KISA.lng,
        startsAt: new Date(Date.now() + minutesFromNow * 60_000).toISOString(),
        timezone: KISA.timezone, organizerName: 'Ana',
      }, { 'x-forwarded-for': `10.0.${Math.floor(Math.random() * 250)}.1` }),
    );
    const data = (await response.json()) as { event: { token: string } };
    const token = data.event.token;
    const cookie = cookieFrom(response, sessionCookieName(token)) ?? '';
    return { token, cookie, header: { cookie: `${sessionCookieName(token)}=${cookie}` } };
  }

  async function snapshot(token: string) {
    const response = await getEventRoute(
      new Request(`http://t/api/events/${token}`), params(token),
    );
    return (await response.json()) as {
      participants: {
        status: string; sharing: boolean; travelMode: string;
        eta: { source: string; etaAt: number } | null;
      }[];
      everyoneHereBy: number | null;
    };
  }

  it('checks in and starts sharing', async () => {
    const { token, header } = await makeEvent();
    const response = await patchMeRoute(
      post(`http://t/api/events/${token}/me`, { status: 'en_route', sharing: true }, header),
      params(token),
    );
    expect(response.status).toBe(200);

    const state = await snapshot(token);
    expect(state.participants[0]?.status).toBe('en_route');
    expect(state.participants[0]?.sharing).toBe(true);
  });

  it('accepts a position and produces an ETA', async () => {
    const { token, header } = await makeEvent();
    const response = await positionRoute(
      post(`http://t/api/events/${token}/me/position`, {
        ...FAR, accuracyM: 12, recordedAt: new Date().toISOString(), source: 'web',
      }, header),
      params(token),
    );
    expect(response.status).toBe(200);
    expect((await response.json()) as { accepted: number }).toMatchObject({ accepted: 1 });

    const state = await snapshot(token);
    expect(state.participants[0]?.eta?.source).toBe('straight_line');
    expect(state.everyoneHereBy).not.toBeNull();
  });

  it('accepts a batch from a flushed offline queue', async () => {
    const { token, header } = await makeEvent();
    const start = Date.now() - 5 * 60_000;
    const response = await positionRoute(
      post(`http://t/api/events/${token}/me/position`, {
        positions: [
          { ...FAR, accuracyM: 20, recordedAt: start },
          { ...FAR, lat: FAR.lat - 0.002, accuracyM: 15, recordedAt: start + 60_000 },
          { ...FAR, lat: FAR.lat - 0.004, accuracyM: 10, recordedAt: start + 120_000 },
        ],
        source: 'web',
      }, header),
      params(token),
    );
    expect((await response.json()) as { accepted: number }).toMatchObject({ accepted: 3 });
  });

  it('arrives automatically after dwelling at the venue', async () => {
    const { token, header } = await makeEvent();
    const start = Date.now() - ARRIVAL_DWELL_MS - 30_000;

    const response = await positionRoute(
      post(`http://t/api/events/${token}/me/position`, {
        positions: [
          { ...AT_DOOR, accuracyM: 10, recordedAt: start },
          { ...AT_DOOR, accuracyM: 10, recordedAt: start + ARRIVAL_DWELL_MS + 1_000 },
        ],
        source: 'web',
      }, header),
      params(token),
    );
    expect((await response.json()) as { arrived: boolean }).toMatchObject({ arrived: true });

    const state = await snapshot(token);
    expect(state.participants[0]?.status).toBe('arrived');
    expect(state.participants[0]?.sharing).toBe(false);
  });

  it('refuses positions without a cookie', async () => {
    const { token } = await makeEvent();
    const response = await positionRoute(
      post(`http://t/api/events/${token}/me/position`, {
        ...FAR, accuracyM: 10, recordedAt: Date.now(),
      }),
      params(token),
    );
    expect(response.status).toBe(401);
  });

  it.each([
    ['a latitude out of range', { lat: 200, lng: 0, recordedAt: Date.now() }],
    ['a missing timestamp', { lat: 40.7, lng: -73.9 }],
    ['negative accuracy', { lat: 40.7, lng: -73.9, accuracyM: -5, recordedAt: Date.now() }],
    ['an empty batch', { positions: [] }],
  ])('rejects %s', async (_label, body) => {
    const { token, header } = await makeEvent();
    const response = await positionRoute(
      post(`http://t/api/events/${token}/me/position`, body, header), params(token),
    );
    expect(response.status).toBe(400);
  });

  it('rejects an oversized batch rather than accepting a flood', async () => {
    const { token, header } = await makeEvent();
    const positions = Array.from({ length: 200 }, (_, i) => ({
      ...FAR, accuracyM: 10, recordedAt: Date.now() - i * 1_000,
    }));
    const response = await positionRoute(
      post(`http://t/api/events/${token}/me/position`, { positions }, header), params(token),
    );
    expect(response.status).toBe(400);
  });

  it('rate limits position updates per participant (PS-7)', async () => {
    const { token, header } = await makeEvent();
    const statuses: number[] = [];
    for (let i = 0; i < 9; i += 1) {
      const response = await positionRoute(
        post(`http://t/api/events/${token}/me/position`, {
          ...FAR, accuracyM: 10, recordedAt: Date.now() + i, source: 'web',
        }, header),
        params(token),
      );
      statuses.push(response.status);
    }
    expect(statuses.filter((s) => s === 200)).toHaveLength(6);
    expect(statuses.filter((s) => s === 429)).toHaveLength(3);
  });

  it('records a self-reported ETA when someone refuses location', async () => {
    const { token, header } = await makeEvent();
    const eta = new Date(Date.now() + 20 * 60_000).toISOString();

    const response = await patchMeRoute(
      post(`http://t/api/events/${token}/me`, {
        status: 'en_route', sharing: false, selfReportedEta: eta,
      }, header),
      params(token),
    );
    expect(response.status).toBe(200);

    const state = await snapshot(token);
    expect(state.participants[0]?.status).toBe('en_route');
    expect(state.participants[0]?.sharing).toBe(false);
  });

  it('lets someone mark themselves here with no location at all', async () => {
    const { token, header } = await makeEvent();
    const response = await patchMeRoute(
      post(`http://t/api/events/${token}/me`, { status: 'arrived' }, header), params(token),
    );
    expect(response.status).toBe(200);
    expect((await snapshot(token)).participants[0]?.status).toBe('arrived');
  });

  it('refuses to un-arrive — arrival is sticky (FR-14)', async () => {
    const { token, header } = await makeEvent();
    await patchMeRoute(
      post(`http://t/api/events/${token}/me`, { status: 'arrived' }, header), params(token),
    );
    const response = await patchMeRoute(
      post(`http://t/api/events/${token}/me`, { status: 'en_route' }, header), params(token),
    );
    expect(response.status).toBe(400);
    expect((await snapshot(token)).participants[0]?.status).toBe('arrived');
  });

  it('refuses check-in well before the window opens (FR-9)', async () => {
    const { token, header } = await makeEvent(5 * 60); // five hours out
    const response = await patchMeRoute(
      post(`http://t/api/events/${token}/me`, { status: 'en_route' }, header), params(token),
    );
    expect(response.status).toBe(409);
  });

  // --- native clients carry the same credential as a bearer token (PS-6) ---

  it('gives a native client the secret in the body and no cookie', async () => {
    const response = await createEventRoute(
      post('http://t/api/events', {
        title: 'Dinner', placeName: KISA.placeName, placeAddress: KISA.placeAddress,
        lat: KISA.lat, lng: KISA.lng,
        startsAt: new Date(Date.now() + 30 * 60_000).toISOString(),
        timezone: KISA.timezone, organizerName: 'Ana',
      }, { 'x-forwarded-for': '10.20.30.40', 'x-wat-client': 'native' }),
    );
    const data = (await response.json()) as { sessionSecret?: string };
    expect(data.sessionSecret).toBeTypeOf('string');
    expect(response.headers.getSetCookie()).toHaveLength(0);
  });

  it('never leaks the secret into a browser response body', async () => {
    const { token, cookie } = await makeEvent();
    expect(cookie).not.toBe('');
    const response = await getEventRoute(
      new Request(`http://t/api/events/${token}`), params(token),
    );
    expect(await response.text()).not.toContain('sessionSecret');
  });

  it('accepts a bearer token in place of a cookie', async () => {
    const response = await createEventRoute(
      post('http://t/api/events', {
        title: 'Dinner', placeName: KISA.placeName, placeAddress: KISA.placeAddress,
        lat: KISA.lat, lng: KISA.lng,
        startsAt: new Date(Date.now() + 30 * 60_000).toISOString(),
        timezone: KISA.timezone, organizerName: 'Ana',
      }, { 'x-forwarded-for': '10.20.30.41', 'x-wat-client': 'native' }),
    );
    const data = (await response.json()) as {
      event: { token: string }; sessionSecret: string;
    };

    const patched = await patchMeRoute(
      post(`http://t/api/events/${data.event.token}/me`, { rsvp: 'going' }, {
        authorization: `Bearer ${data.sessionSecret}`,
      }),
      params(data.event.token),
    );
    expect(patched.status).toBe(200);
  });

  it('refuses a bearer token that is not a real session', async () => {
    const { token } = await makeEvent();
    const response = await patchMeRoute(
      post(`http://t/api/events/${token}/me`, { rsvp: 'going' }, {
        authorization: 'Bearer not-a-real-secret',
      }),
      params(token),
    );
    expect(response.status).toBe(401);
  });

  it('accepts a background position by bearer token', async () => {
    const created = await createEventRoute(
      post('http://t/api/events', {
        title: 'Dinner', placeName: KISA.placeName, placeAddress: KISA.placeAddress,
        lat: KISA.lat, lng: KISA.lng,
        startsAt: new Date(Date.now() + 30 * 60_000).toISOString(),
        timezone: KISA.timezone, organizerName: 'Ana',
      }, { 'x-forwarded-for': '10.20.30.42', 'x-wat-client': 'native' }),
    );
    const data = (await created.json()) as {
      event: { token: string }; sessionSecret: string;
    };

    const response = await positionRoute(
      post(`http://t/api/events/${data.event.token}/me/position`, {
        ...FAR, accuracyM: 20, recordedAt: Date.now(), source: 'app_background',
      }, { authorization: `Bearer ${data.sessionSecret}` }),
      params(data.event.token),
    );
    expect(response.status).toBe(200);
  });

  it('changes travel mode, which changes the estimate', async () => {
    const { token, header } = await makeEvent();
    await positionRoute(
      post(`http://t/api/events/${token}/me/position`, {
        ...FAR, accuracyM: 10, recordedAt: Date.now(), source: 'web',
      }, header),
      params(token),
    );
    const driving = (await snapshot(token)).participants[0]?.eta?.etaAt ?? 0;

    await patchMeRoute(
      post(`http://t/api/events/${token}/me`, { travelMode: 'walking' }, header), params(token),
    );
    // A new fix far enough away to earn a recompute under the FR-11 limits.
    await positionRoute(
      post(`http://t/api/events/${token}/me/position`, {
        lat: FAR.lat - 0.005, lng: FAR.lng, accuracyM: 10,
        recordedAt: Date.now() + 1_000, source: 'web',
      }, header),
      params(token),
    );
    const walking = (await snapshot(token)).participants[0]?.eta?.etaAt ?? 0;

    expect(walking).toBeGreaterThan(driving);
  });
});
