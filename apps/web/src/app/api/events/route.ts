import { inviteUrl, validateDisplayName } from '@wat/core';
import { createEvent } from '@/lib/events';
import { badRequest } from '@/lib/errors';
import {
  clientIp, handle, json, readJson, setSessionCookie,
} from '@/lib/http';
import {
  asObject, optionalString, requireLatLng, requireString, requireTimestamp,
  requireTimezone,
} from '@/lib/parse';
import { isValidPinFormat } from '@/lib/pin';
import { cookieOptions } from '@/lib/session';
import { enforce } from '@/lib/ratelimit';

/** FR-1 — create an event. */
export function POST(request: Request): Promise<Response> {
  return handle(async () => {
    await enforce('createEvent', clientIp(request));

    const body = asObject(await readJson(request));

    const organizer = validateDisplayName(requireString(body, 'organizerName'));
    if (!organizer.ok) throw badRequest(organizer.error);

    const placeName = requireString(body, 'placeName');
    const placeAddress = optionalString(body, 'placeAddress') ?? placeName;
    const { lat, lng } = requireLatLng(body);
    const startsAt = requireTimestamp(body, 'startsAt');
    const timezone = requireTimezone(body, 'timezone');

    const title = (optionalString(body, 'title') ?? 'Dinner').trim() || 'Dinner';
    if (title.length > 80) throw badRequest('Keep the title to 80 characters.');

    const pin = optionalString(body, 'pin');
    if (pin !== undefined && !isValidPinFormat(pin)) {
      throw badRequest('A PIN must be exactly four digits.');
    }

    const created = await createEvent({
      title, placeName, placeAddress, lat, lng, startsAt, timezone,
      pin, organizerName: organizer.value,
    });

    const base = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
    const options = cookieOptions();

    const response = json(
      {
        event: created.event,
        participantId: created.participantId,
        inviteUrl: inviteUrl(base, created.event.token),
      },
      201,
    );

    return setSessionCookie(response, created.event.token, created.session.secret, {
      secure: options.secure,
      maxAge: options.maxAge,
    });
  });
}
