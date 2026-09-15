import { QUICK_REPLIES, lateEta, validateMessage } from '@wat/core';
import { lastReadAt, listFeed, postMessage } from '@/lib/feed';
import { badRequest, conflict } from '@/lib/errors';
import {
  handle, json, readJson, requireEvent, requireParticipant, sessionSecretFrom,
} from '@/lib/http';
import { findParticipantBySession } from '@/lib/events';
import { asObject, optionalString } from '@/lib/parse';
import { enforce } from '@/lib/ratelimit';
import { hashSessionSecret } from '@/lib/session';
import { setCheckinState } from '@/lib/tracking';

/**
 * FR-15 — the thread is readable without joining, because the invite page
 * should show you what you are being invited to. Posting requires having
 * joined.
 */
export function GET(
  request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  return handle(async () => {
    const { token } = await context.params;
    const event = await requireEvent(token);

    const secret = sessionSecretFrom(request, event.token);
    const me =
      secret === null
        ? null
        : await findParticipantBySession(event.id, hashSessionSecret(secret));

    return json({
      entries: await listFeed(event.id),
      lastReadAt: me === null ? null : await lastReadAt(me.id),
      serverTime: Date.now(),
    });
  });
}

export function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  return handle(async () => {
    const { token } = await context.params;
    const event = await requireEvent(token);
    const me = await requireParticipant(request, event);

    if (event.status === 'cancelled') {
      throw conflict('This event was cancelled.', 'event_cancelled');
    }

    await enforce('message', me.id);

    const body = asObject(await readJson(request));

    // A quick reply is one tap, and two of the three change state as well as
    // saying something — so the feed and the list cannot contradict each other.
    const quickReplyId = optionalString(body, 'quickReply');
    if (quickReplyId !== undefined) {
      const reply = QUICK_REPLIES.find((candidate) => candidate.id === quickReplyId);
      if (reply === undefined) throw badRequest('Unknown quick reply.');

      if (reply.checksIn === true && me.status === 'not_started') {
        await setCheckinState({
          participantId: me.id, event, status: 'en_route', sharing: false,
          source: 'manual',
        });
      }
      if (reply.lateMinutes !== undefined) {
        await setCheckinState({
          participantId: me.id,
          event,
          ...(me.status === 'not_started' ? { status: 'en_route' as const } : {}),
          selfReportedEta: lateEta(event.startsAt, reply.lateMinutes, Date.now()),
          source: 'manual',
        });
      }

      const entry = await postMessage({
        eventId: event.id, participantId: me.id,
        authorName: me.displayName, body: reply.message,
      });
      return json({ entry }, 201);
    }

    const validated = validateMessage(optionalString(body, 'body') ?? '');
    if (!validated.ok) throw badRequest(validated.error);

    const entry = await postMessage({
      eventId: event.id, participantId: me.id,
      authorName: me.displayName, body: validated.value,
    });
    return json({ entry }, 201);
  });
}
