import { isValidEventToken, sortRoster } from '@wat/core';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import {
  findEventByToken, findParticipantBySession, listParticipants,
} from '@/lib/events';
import { lastReadAt, listFeed } from '@/lib/feed';
import { hashSessionSecret, sessionCookieName } from '@/lib/session';
import EventView from './EventView';

/**
 * FR-8 — the invite target. Rendered on the server so the first paint already
 * shows what you are being invited to, rather than a spinner: this page is the
 * product's front door and it is usually opened on a phone in a group chat.
 */
export default async function EventPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!isValidEventToken(token)) notFound();

  const event = await findEventByToken(token);
  if (event === null) notFound();

  const cookieStore = await cookies();
  const secret = cookieStore.get(sessionCookieName(token))?.value ?? null;
  const me =
    secret === null
      ? null
      : await findParticipantBySession(event.id, hashSessionSecret(secret));

  const participants = await listParticipants(event.id);
  const entries = await listFeed(event.id);
  const readAt = me === null ? null : await lastReadAt(me.id);

  return (
    <EventView
      initial={{
        event: {
          token: event.token,
          title: event.title,
          venue: event.venue,
          startsAt: event.startsAt,
          timezone: event.timezone,
          status: event.status,
        },
        participants: sortRoster(participants, Date.now()),
        me: me === null ? null : { id: me.id },
        feed: { entries, lastReadAt: readAt },
      }}
    />
  );
}
