import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { unreadCount, type FeedEntry } from '@wat/core';
import { closePool } from './db';
import { sessionCookieName } from './session';
import { KISA, applyMigrations, cookieFrom, describeWithDb, resetData } from './test-db';

import { POST as createEventRoute } from '@/app/api/events/route';
import { GET as getEventRoute } from '@/app/api/events/[token]/route';
import { POST as joinRoute } from '@/app/api/events/[token]/join/route';
import { PATCH as patchMeRoute } from '@/app/api/events/[token]/me/route';
import {
  GET as getFeedRoute, POST as postMessageRoute,
} from '@/app/api/events/[token]/messages/route';
import { POST as markReadRoute } from '@/app/api/events/[token]/me/read/route';

function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
const params = (token: string) => ({ params: Promise.resolve({ token }) });

describeWithDb('feed routes', () => {
  beforeAll(applyMigrations);
  beforeEach(resetData);
  afterAll(closePool);

  let ipCounter = 0;

  async function makeEvent(minutesFromNow = 30) {
    ipCounter += 1;
    const response = await createEventRoute(
      post('http://t/api/events', {
        title: 'Dinner at Kisa',
        placeName: KISA.placeName, placeAddress: KISA.placeAddress,
        lat: KISA.lat, lng: KISA.lng,
        startsAt: new Date(Date.now() + minutesFromNow * 60_000).toISOString(),
        timezone: KISA.timezone, organizerName: 'Ana',
      }, { 'x-forwarded-for': `10.30.${ipCounter}.1` }),
    );
    const data = (await response.json()) as { event: { token: string } };
    const token = data.event.token;
    const cookie = cookieFrom(response, sessionCookieName(token)) ?? '';
    return { token, header: { cookie: `${sessionCookieName(token)}=${cookie}` } };
  }

  async function join(token: string, name: string) {
    ipCounter += 1;
    const response = await joinRoute(
      post(`http://t/api/events/${token}/join`, { displayName: name },
        { 'x-forwarded-for': `10.31.${ipCounter}.1` }),
      params(token),
    );
    const cookie = cookieFrom(response, sessionCookieName(token)) ?? '';
    return { cookie: `${sessionCookieName(token)}=${cookie}` };
  }

  async function feed(token: string, headers: Record<string, string> = {}) {
    const response = await getFeedRoute(
      new Request(`http://t/api/events/${token}/messages`, { headers }),
      params(token),
    );
    return (await response.json()) as {
      entries: FeedEntry[]; lastReadAt: number | null;
    };
  }

  it('starts the thread with the organizer creating the event', async () => {
    const { token } = await makeEvent();
    const { entries } = await feed(token);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.kind).toBe('joined');
    expect(entries[0]?.authorName).toBe('Ana');
    expect(entries[0]?.meta).toMatchObject({ organizer: true });
  });

  it('is readable without joining — the invite page shows what you are joining', async () => {
    const { token } = await makeEvent();
    const response = await getFeedRoute(
      new Request(`http://t/api/events/${token}/messages`), params(token),
    );
    expect(response.status).toBe(200);
  });

  it('refuses posting without joining', async () => {
    const { token } = await makeEvent();
    const response = await postMessageRoute(
      post(`http://t/api/events/${token}/messages`, { body: 'hello' }), params(token),
    );
    expect(response.status).toBe(401);
  });

  it('posts a message attributed by name', async () => {
    const { token } = await makeEvent();
    const marco = await join(token, 'Marco');

    const response = await postMessageRoute(
      post(`http://t/api/events/${token}/messages`, { body: '  grabbing the table  ' },
        { cookie: marco.cookie }),
      params(token),
    );
    expect(response.status).toBe(201);

    const { entries } = await feed(token);
    const message = entries.find((e) => e.kind === 'text');
    expect(message?.body).toBe('grabbing the table');
    expect(message?.authorName).toBe('Marco');
  });

  it.each([
    ['an empty message', { body: '   ' }],
    ['a message over 500 characters', { body: 'x'.repeat(501) }],
    ['an unknown quick reply', { quickReply: 'nope' }],
  ])('rejects %s', async (_label, body) => {
    const { token, header } = await makeEvent();
    const response = await postMessageRoute(
      post(`http://t/api/events/${token}/messages`, body, header), params(token),
    );
    expect(response.status).toBe(400);
  });

  it('interleaves what happened with what people said', async () => {
    const { token, header } = await makeEvent();
    const marco = await join(token, 'Marco');

    await postMessageRoute(
      post(`http://t/api/events/${token}/messages`, { body: 'running out now' },
        { cookie: marco.cookie }),
      params(token),
    );
    await patchMeRoute(
      post(`http://t/api/events/${token}/me`, { rsvp: 'going' }, { cookie: marco.cookie }),
      params(token),
    );
    await patchMeRoute(
      post(`http://t/api/events/${token}/me`, { status: 'arrived' }, header),
      params(token),
    );

    const { entries } = await feed(token);
    const kinds = entries.map((e) => e.kind);
    expect(kinds).toContain('joined');
    expect(kinds).toContain('text');
    expect(kinds).toContain('rsvp');
    expect(kinds).toContain('arrived');

    // Oldest first, so it reads as a thread.
    const times = entries.map((e) => e.createdAt);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('posts an RSVP event only when the answer actually changed', async () => {
    const { token } = await makeEvent();
    const marco = await join(token, 'Marco');

    await patchMeRoute(
      post(`http://t/api/events/${token}/me`, { rsvp: 'going' }, { cookie: marco.cookie }),
      params(token),
    );
    await patchMeRoute(
      post(`http://t/api/events/${token}/me`, { rsvp: 'going' }, { cookie: marco.cookie }),
      params(token),
    );

    const { entries } = await feed(token);
    expect(entries.filter((e) => e.kind === 'rsvp')).toHaveLength(1);
  });

  it('records checking in, once per transition', async () => {
    const { token, header } = await makeEvent();
    await patchMeRoute(
      post(`http://t/api/events/${token}/me`, { status: 'en_route', sharing: true }, header),
      params(token),
    );
    await patchMeRoute(
      post(`http://t/api/events/${token}/me`, { sharing: false }, header), params(token),
    );

    const { entries } = await feed(token);
    expect(entries.filter((e) => e.kind === 'checked_in')).toHaveLength(1);
  });

  // --- quick replies change state, not just the thread ---------------------

  it('"On my way" checks the sender in as well as posting', async () => {
    const { token, header } = await makeEvent();
    const response = await postMessageRoute(
      post(`http://t/api/events/${token}/messages`, { quickReply: 'omw' }, header),
      params(token),
    );
    expect(response.status).toBe(201);

    const snapshot = await getEventRoute(
      new Request(`http://t/api/events/${token}`), params(token),
    );
    const data = (await snapshot.json()) as { participants: { status: string }[] };
    expect(data.participants[0]?.status).toBe('en_route');

    const { entries } = await feed(token);
    expect(entries.some((e) => e.kind === 'text' && e.body === 'On my way')).toBe(true);
    expect(entries.some((e) => e.kind === 'checked_in')).toBe(true);
  });

  it('"Running 10 late" moves the sender ETA so the feed and list agree', async () => {
    const { token, header } = await makeEvent(30);
    await postMessageRoute(
      post(`http://t/api/events/${token}/messages`, { quickReply: 'late10' }, header),
      params(token),
    );

    const snapshot = await getEventRoute(
      new Request(`http://t/api/events/${token}`), params(token),
    );
    const data = (await snapshot.json()) as {
      participants: { status: string; selfReportedEta: number | null }[];
    };
    const me = data.participants[0];
    expect(me?.status).toBe('en_route');
    expect(me?.selfReportedEta).not.toBeNull();
    // Ten minutes after the start time, not ten minutes from now.
    expect(me?.selfReportedEta).toBeGreaterThan(Date.now() + 30 * 60_000);

    const { entries } = await feed(token);
    expect(entries.some((e) => e.kind === 'late')).toBe(true);
  });

  it('"Grab a table" is only a message', async () => {
    const { token, header } = await makeEvent();
    await postMessageRoute(
      post(`http://t/api/events/${token}/messages`, { quickReply: 'table' }, header),
      params(token),
    );
    const snapshot = await getEventRoute(
      new Request(`http://t/api/events/${token}`), params(token),
    );
    const data = (await snapshot.json()) as { participants: { status: string }[] };
    expect(data.participants[0]?.status).toBe('not_started');
  });

  it('rate limits messages per participant (PS-7)', async () => {
    const { token, header } = await makeEvent();
    const statuses: number[] = [];
    for (let i = 0; i < 23; i += 1) {
      const response = await postMessageRoute(
        post(`http://t/api/events/${token}/messages`, { body: `message ${i}` }, header),
        params(token),
      );
      statuses.push(response.status);
    }
    expect(statuses.filter((s) => s === 201)).toHaveLength(20);
    expect(statuses.filter((s) => s === 429)).toHaveLength(3);
  });

  // --- unread ---------------------------------------------------------------

  it('counts what others said and clears on read', async () => {
    const { token, header } = await makeEvent();
    const marco = await join(token, 'Marco');

    await postMessageRoute(
      post(`http://t/api/events/${token}/messages`, { body: 'on my way' },
        { cookie: marco.cookie }),
      params(token),
    );

    const before = await feed(token, header);
    const organizerId = before.entries.find((e) => e.kind === 'joined')?.participantId ?? null;
    expect(unreadCount(before.entries, before.lastReadAt, organizerId)).toBe(1);

    const read = await markReadRoute(
      post(`http://t/api/events/${token}/me/read`, {}, header), params(token),
    );
    expect(read.status).toBe(200);

    const after = await feed(token, header);
    expect(unreadCount(after.entries, after.lastReadAt, organizerId)).toBe(0);
  });

  it('keeps a departed author readable in the thread', async () => {
    const { token } = await makeEvent();
    const marco = await join(token, 'Marco');
    await postMessageRoute(
      post(`http://t/api/events/${token}/messages`, { body: 'see you there' },
        { cookie: marco.cookie }),
      params(token),
    );

    const { DELETE: leaveRoute } = await import('@/app/api/events/[token]/me/route');
    await leaveRoute(
      new Request(`http://t/api/events/${token}/me`, {
        method: 'DELETE', headers: { cookie: marco.cookie },
      }),
      params(token),
    );

    const { entries } = await feed(token);
    const message = entries.find((e) => e.body === 'see you there');
    expect(message?.participantId).toBeNull();
    expect(message?.authorName).toBe('Marco');
  });
});
