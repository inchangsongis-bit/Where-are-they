import { everyoneHereBy, sortRoster, summarise } from '@wat/core';
import { listParticipants } from '@/lib/events';
import { handle, json, requireEvent, sessionSecretFrom } from '@/lib/http';
import { findParticipantBySession } from '@/lib/events';
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
