import { listParticipants } from '@/lib/events';
import { badRequest, conflict } from '@/lib/errors';
import { handle, json, readJson, requireEvent, requireParticipant } from '@/lib/http';
import { notifyNudge } from '@/lib/notify';
import { asObject, requireString } from '@/lib/parse';

/**
 * FR-18 — nudge someone who has not set off.
 *
 * One per person per event, enforced by the dedupe ledger rather than by a
 * rate limit: a nudge is a social act, and the second one is not a mistake in
 * timing, it is nagging.
 */
export function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  return handle(async () => {
    const { token } = await context.params;
    const event = await requireEvent(token);
    const me = await requireParticipant(request, event);

    const body = asObject(await readJson(request));
    const targetId = requireString(body, 'participantId');

    if (targetId === me.id) throw badRequest('You can nudge other people.');

    const roster = await listParticipants(event.id);
    const target = roster.find((participant) => participant.id === targetId);
    if (target === undefined) throw badRequest('That person is not in this event.');
    if (target.status !== 'not_started') {
      throw conflict('They are already on their way.', 'already_started');
    }

    const nudged = await notifyNudge({
      eventId: event.id,
      eventTitle: event.title,
      fromParticipantId: me.id,
      toParticipantId: targetId,
    });

    // A nudge that could not be delivered is reported honestly rather than as
    // a success: the sender should not think it landed.
    return json({ nudged });
  });
}
