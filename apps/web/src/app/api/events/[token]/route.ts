import { everyoneHereBy, sortRoster, summarise } from '@wat/core';
import { cancelEvent, findParticipantBySession, listParticipants } from '@/lib/events';
import { conflict, forbidden } from '@/lib/errors';
import {
  handle, json, readJson, requireEvent, requireParticipant, sessionSecretFrom,
} from '@/lib/http';
import { asObject } from '@/lib/parse';
import { hashSessionSecret } from '@/lib/session';

/**
 * Full state snapshot. Deliberately readable without joining — the invite link
 * should show you what you are being invited to before asking for your name.
 * The PIN gate (FR-2) sits in front of this at the page level.
 */
export function GET(
  request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  return handle(async () => {
    const { token } = await context.params;
    const event = await requireEvent(token);

    const participants = await listParticipants(event.id);
    const now = Date.now();

    const secret = sessionSecretFrom(request, event.token);
    const me =
      secret === null
        ? null
        : await findParticipantBySession(event.id, hashSessionSecret(secret));

    return json({
      event,
      participants: sortRoster(participants, now),
      summary: summarise(participants),
      everyoneHereBy: everyoneHereBy(participants, now),
      me: me === null ? null : { id: me.id },
      serverTime: now,
    });
  });
}

/** FR-7 — cancel the event. Organizer only. */
export function PATCH(
  request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  return handle(async () => {
    const { token } = await context.params;
    const event = await requireEvent(token);
    const me = await requireParticipant(request, event);

    // Only the person who created it. Anyone else calling off a dinner for six
    // is not a feature.
    if (!me.isOrganizer) {
      throw forbidden('Only the organizer can cancel this.', 'not_organizer');
    }

    const body = asObject(await readJson(request));
    if (body['status'] !== 'cancelled') {
      throw conflict('Only cancelling is supported.', 'unsupported');
    }
    if (event.status === 'cancelled') {
      return json({ ok: true, alreadyCancelled: true });
    }

    await cancelEvent({
      eventId: event.id, byParticipantId: me.id, byName: me.displayName,
    });

    return json({ ok: true });
  });
}
