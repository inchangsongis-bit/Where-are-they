import { validateDisplayName } from '@wat/core';
import type { ParticipantStatus, Rsvp, TravelMode } from '@wat/core';
import { query } from '@/lib/db';
import { leaveEvent, listParticipants, updateParticipant } from '@/lib/events';
import { badRequest } from '@/lib/errors';
import { handle, json, readJson, requireEvent, requireParticipant } from '@/lib/http';
import { asObject, optionalString, requireEnum, requireTimestamp } from '@/lib/parse';
import { setCheckinState } from '@/lib/tracking';

const RSVPS: readonly Rsvp[] = ['pending', 'going', 'maybe', 'cant'];
const MODES: readonly TravelMode[] = ['driving', 'walking', 'transit', 'cycling'];
// FR-9/FR-14 — a client may check in, stop, or declare itself here. It may not
// set 'not_started' backwards out of 'arrived': arrival is sticky.
const SETTABLE_STATUSES: readonly ParticipantStatus[] = [
  'not_started', 'en_route', 'arrived',
];

/** FR-3/FR-9/FR-14 — RSVP, rename, travel mode, check-in. Only your own row. */
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

    const status =
      body['status'] === undefined
        ? undefined
        : requireEnum(body, 'status', SETTABLE_STATUSES);

    const sharing = body['sharing'] === undefined ? undefined : body['sharing'] === true;
    const muted = body['muted'] === undefined ? undefined : body['muted'] === true;

    let selfReportedEta: number | null | undefined;
    if (body['selfReportedEta'] === null) selfReportedEta = null;
    else if (body['selfReportedEta'] !== undefined) {
      selfReportedEta = requireTimestamp(body, 'selfReportedEta');
    }

    const nothingToDo =
      rsvp === undefined && travelMode === undefined && displayName === undefined &&
      status === undefined && sharing === undefined && selfReportedEta === undefined &&
      muted === undefined;
    if (nothingToDo) throw badRequest('Nothing to change.');

    // FR-14 — arrival is sticky, so it cannot be undone by a later request.
    if (me.status === 'arrived' && status !== undefined && status !== 'arrived') {
      throw badRequest('You are already marked as here.', 'already_arrived');
    }

    if (rsvp !== undefined || travelMode !== undefined || displayName !== undefined) {
      await updateParticipant(me.id, { rsvp, travelMode, displayName });
    }

    if (status !== undefined || sharing !== undefined || selfReportedEta !== undefined) {
      await setCheckinState({
        participantId: me.id, event, status, sharing, selfReportedEta,
        source: status === 'en_route' && sharing === false ? 'manual' : undefined,
      });
    }

    if (muted !== undefined) {
      await query('update participants set muted = $2 where id = $1', [me.id, muted]);
    }

    const roster = await listParticipants(event.id);
    const updated = roster.find((p) => p.id === me.id);
    if (updated === undefined) throw badRequest('You are no longer in this event.');

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
