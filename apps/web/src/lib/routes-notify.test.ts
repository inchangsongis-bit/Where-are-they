import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { closePool, query } from './db';
import { NoopPush, setPushProvider } from './push';
import { notifyEvent, notifyMessage } from './notify';
import { sessionCookieName } from './session';
import { KISA, applyMigrations, cookieFrom, describeWithDb, resetData } from './test-db';

import { POST as createEventRoute } from '@/app/api/events/route';
import { POST as joinRoute } from '@/app/api/events/[token]/join/route';
import { PATCH as patchMeRoute } from '@/app/api/events/[token]/me/route';
import { POST as pushTokenRoute } from '@/app/api/events/[token]/me/push-token/route';
import { POST as nudgeRoute } from '@/app/api/events/[token]/nudge/route';
import { POST as postMessageRoute } from '@/app/api/events/[token]/messages/route';
import { POST as notifyCronRoute } from '@/app/api/cron/notify/route';

function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
const params = (token: string) => ({ params: Promise.resolve({ token }) });

describeWithDb('notifications', () => {
  let push: NoopPush;
  let ip = 0;

  beforeAll(applyMigrations);
  beforeEach(async () => {
    await resetData();
    push = new NoopPush();
    setPushProvider(push);
    process.env.CRON_SECRET = 'test-secret';
  });
  afterEach(() => setPushProvider(undefined));
  afterAll(closePool);

  async function makeEvent(minutesFromNow = 20) {
    ip += 1;
    const response = await createEventRoute(
      post('http://t/api/events', {
        title: 'Dinner at Kisa',
        placeName: KISA.placeName, placeAddress: KISA.placeAddress,
        lat: KISA.lat, lng: KISA.lng,
        startsAt: new Date(Date.now() + minutesFromNow * 60_000).toISOString(),
        timezone: KISA.timezone, organizerName: 'Ana',
      }, { 'x-forwarded-for': `10.40.${ip}.1` }),
    );
    const data = (await response.json()) as {
      event: { id: string; token: string; title: string; startsAt: number };
    };
    const cookie = cookieFrom(response, sessionCookieName(data.event.token)) ?? '';
    return {
      event: data.event,
      header: { cookie: `${sessionCookieName(data.event.token)}=${cookie}` },
    };
  }

  async function addPerson(token: string, name: string) {
    ip += 1;
    const response = await joinRoute(
      post(`http://t/api/events/${token}/join`, { displayName: name },
        { 'x-forwarded-for': `10.41.${ip}.1` }),
      params(token),
    );
    const data = (await response.json()) as { participant: { id: string } };
    const cookie = cookieFrom(response, sessionCookieName(token)) ?? '';
    return {
      id: data.participant.id,
      header: { cookie: `${sessionCookieName(token)}=${cookie}` },
    };
  }

  async function register(token: string, headers: Record<string, string>, value: string) {
    return pushTokenRoute(
      post(`http://t/api/events/${token}/me/push-token`, { pushToken: value }, headers),
      params(token),
    );
  }

  // --- token registration ---------------------------------------------------

  it('registers and revokes a device token', async () => {
    const { event, header } = await makeEvent();
    const registered = await register(event.token, header, 'ExponentPushToken[abc]');
    expect((await registered.json()) as { registered: boolean }).toMatchObject({
      registered: true,
    });

    const revoked = await pushTokenRoute(
      post(`http://t/api/events/${event.token}/me/push-token`, {}, header),
      params(event.token),
    );
    expect((await revoked.json()) as { registered: boolean }).toMatchObject({
      registered: false,
    });
  });

  it('refuses a token from someone who has not joined', async () => {
    const { event } = await makeEvent();
    const response = await pushTokenRoute(
      post(`http://t/api/events/${event.token}/me/push-token`, { pushToken: 'x' }),
      params(event.token),
    );
    expect(response.status).toBe(401);
  });

  // --- the tick -------------------------------------------------------------

  it('sends a proximity notification once, and never again', async () => {
    const { event, header } = await makeEvent();
    await register(event.token, header, 'ExponentPushToken[ana]');

    const marco = await addPerson(event.token, 'Marco');
    await register(event.token, marco.header, 'ExponentPushToken[marco]');
    await patchMeRoute(
      post(`http://t/api/events/${event.token}/me`, {
        status: 'en_route',
        selfReportedEta: new Date(Date.now() + 3 * 60_000).toISOString(),
      }, marco.header),
      params(event.token),
    );

    const first = await notifyEvent({
      eventId: event.id, eventTitle: event.title, startsAt: event.startsAt,
    });
    expect(first.planned).toBeGreaterThanOrEqual(1);
    expect(push.sent.some((m) => m.body.includes('Marco is 5 minutes away'))).toBe(true);
    // Never to the subject themselves.
    expect(push.sent.every((m) => m.to !== 'ExponentPushToken[marco]' ||
      !m.body.includes('Marco is 5'))).toBe(true);

    push.sent.length = 0;
    const second = await notifyEvent({
      eventId: event.id, eventTitle: event.title, startsAt: event.startsAt,
    });
    expect(second.planned).toBe(0);
    expect(push.sent).toHaveLength(0);
  });

  it('sends nothing to someone who muted the event', async () => {
    const { event, header } = await makeEvent();
    await register(event.token, header, 'ExponentPushToken[ana]');
    await patchMeRoute(
      post(`http://t/api/events/${event.token}/me`, { muted: true }, header),
      params(event.token),
    );

    const marco = await addPerson(event.token, 'Marco');
    await register(event.token, marco.header, 'ExponentPushToken[marco]');
    await patchMeRoute(
      post(`http://t/api/events/${event.token}/me`, {
        status: 'en_route',
        selfReportedEta: new Date(Date.now() + 3 * 60_000).toISOString(),
      }, marco.header),
      params(event.token),
    );

    await notifyEvent({
      eventId: event.id, eventTitle: event.title, startsAt: event.startsAt,
    });
    expect(push.sent.some((m) => m.to === 'ExponentPushToken[ana]')).toBe(false);
  });

  it('drops a token the push service reports as dead (PS-12)', async () => {
    const { event, header } = await makeEvent();
    await register(event.token, header, 'ExponentPushToken[dead]');

    setPushProvider({
      name: 'stub',
      send: () => Promise.resolve({ sent: 0, invalidTokens: ['ExponentPushToken[dead]'] }),
    });

    const marco = await addPerson(event.token, 'Marco');
    await register(event.token, marco.header, 'ExponentPushToken[marco]');
    await patchMeRoute(
      post(`http://t/api/events/${event.token}/me`, {
        status: 'en_route',
        selfReportedEta: new Date(Date.now() + 3 * 60_000).toISOString(),
      }, marco.header),
      params(event.token),
    );

    await notifyEvent({
      eventId: event.id, eventTitle: event.title, startsAt: event.startsAt,
    });

    const rows = await query<{ push_token: string | null }>(
      `select push_token from participants where event_id = $1 and display_name = 'Ana'`,
      [event.id],
    );
    expect(rows[0]?.push_token).toBeNull();
  });

  // --- nudge ----------------------------------------------------------------

  it('nudges someone who has not set off, once', async () => {
    const { event, header } = await makeEvent();
    const jules = await addPerson(event.token, 'Jules');
    await register(event.token, jules.header, 'ExponentPushToken[jules]');

    const first = await nudgeRoute(
      post(`http://t/api/events/${event.token}/nudge`, { participantId: jules.id }, header),
      params(event.token),
    );
    expect((await first.json()) as { nudged: boolean }).toMatchObject({ nudged: true });
    expect(push.sent.some((m) => m.body.includes('wondering where you are'))).toBe(true);

    const second = await nudgeRoute(
      post(`http://t/api/events/${event.token}/nudge`, { participantId: jules.id }, header),
      params(event.token),
    );
    // The second nudge is not a timing mistake, it is nagging.
    expect((await second.json()) as { nudged: boolean }).toMatchObject({ nudged: false });
  });

  it('refuses to nudge someone already on their way', async () => {
    const { event, header } = await makeEvent();
    const marco = await addPerson(event.token, 'Marco');
    await patchMeRoute(
      post(`http://t/api/events/${event.token}/me`, { status: 'en_route' }, marco.header),
      params(event.token),
    );

    const response = await nudgeRoute(
      post(`http://t/api/events/${event.token}/nudge`, { participantId: marco.id }, header),
      params(event.token),
    );
    expect(response.status).toBe(409);
  });

  it('refuses to nudge yourself', async () => {
    const { event, header } = await makeEvent();
    const rows = await query<{ id: string }>(
      `select id from participants where event_id = $1`, [event.id],
    );
    const response = await nudgeRoute(
      post(`http://t/api/events/${event.token}/nudge`, { participantId: rows[0]?.id }, header),
      params(event.token),
    );
    expect(response.status).toBe(400);
  });

  // --- messages -------------------------------------------------------------

  it('collapses a burst of messages into one notification', async () => {
    const { event, header } = await makeEvent();
    await register(event.token, header, 'ExponentPushToken[ana]');
    const marco = await addPerson(event.token, 'Marco');
    await register(event.token, marco.header, 'ExponentPushToken[marco]');

    for (const body of ['one', 'two', 'three']) {
      await postMessageRoute(
        post(`http://t/api/events/${event.token}/messages`, { body }, marco.header),
        params(event.token),
      );
    }

    expect(push.sent.filter((m) => m.body.includes('said something'))).toHaveLength(1);
  });

  it('notifies again after the collapse window', async () => {
    const { event, header } = await makeEvent();
    await register(event.token, header, 'ExponentPushToken[ana]');
    const marco = await addPerson(event.token, 'Marco');

    await notifyMessage({
      eventId: event.id, eventTitle: event.title, authorId: marco.id,
      now: Date.now() - 120_000,
    });
    push.sent.length = 0;

    const again = await notifyMessage({
      eventId: event.id, eventTitle: event.title, authorId: marco.id,
    });
    expect(again).toBe(true);
  });

  // --- the cron route -------------------------------------------------------

  it('refuses the notify tick without the secret', async () => {
    const response = await notifyCronRoute(
      new Request('http://t/api/cron/notify', { method: 'POST' }),
    );
    expect(response.status).toBe(401);
  });

  it('runs the tick over active events only', async () => {
    await makeEvent(20);
    await makeEvent(60 * 24 * 30); // next month: outside the window

    const response = await notifyCronRoute(
      new Request('http://t/api/cron/notify', {
        method: 'POST', headers: { authorization: 'Bearer test-secret' },
      }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()) as { events: number }).toMatchObject({ events: 1 });
  });
});
