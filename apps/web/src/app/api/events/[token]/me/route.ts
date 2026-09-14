import { validateDisplayName } from '@wat/core';
import type { Rsvp, TravelMode } from '@wat/core';
import { leaveEvent, updateParticipant } from '@/lib/events';
import { badRequest } from '@/lib/errors';
import { handle, json, readJson, requireEvent, requireParticipant } from '@/lib/http';
import { asObject, optionalString, requireEnum } from '@/lib/parse';

const RSVPS: readonly Rsvp[] = ['pending', 'going', 'maybe', 'cant'];
const MODES: readonly TravelMode[] = ['driving', 'walking', 'transit', 'cycling'];

/** FR-3 — RSVP, rename, travel mode. Only ever your own row. */
export function PATCH(
  request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  return handle(async () => {
    const { token } = await context.params;
    const event = await requireEvent(token);
    const me = await requireParticipant(request, event);

    const body = asObject(await readJson(request));

    const rsvp = body['rsvp'] === undefined ? undefined : requireEnum(body, 'rsvp', RSVPS);
    const travelMode =
      body['travelMode'] === undefined ? undefined : requireEnum(body, 'travelMode', MODES);

    let displayName: string | undefined;
    const rawName = optionalString(body, 'displayName');
    if (rawName !== undefined) {
      const validated = validateDisplayName(rawName);
      if (!validated.ok) throw badRequest(validated.error);
      displayName = validated.value;
    }

    if (rsvp === undefined && travelMode === undefined && displayName === undefined) {
      throw badRequest('Nothing to change.');
    }

    const updated = await updateParticipant(me.id, { rsvp, travelMode, displayName });
    return json({ participant: updated });
  });
}

export function DELETE(
  request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  return handle(async () => {
    const { token } = await context.params;
    const event = await requireEvent(token);
    const me = await requireParticipant(request, event);
    await leaveEvent(me.id);
    return json({ ok: true });
  });
}
