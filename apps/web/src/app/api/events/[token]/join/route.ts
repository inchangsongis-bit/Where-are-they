import { disambiguate, validateDisplayName } from '@wat/core';
import { findParticipantBySession, joinEvent, listParticipants } from '@/lib/events';
import { badRequest, conflict } from '@/lib/errors';
import {
  clientIp, handle, json, readJson, requireEvent, sessionSecretFrom,
  setSessionCookie, wantsSecretInBody,
} from '@/lib/http';
import { asObject, optionalString } from '@/lib/parse';
import { enforce } from '@/lib/ratelimit';
import { cookieOptions, hashSessionSecret } from '@/lib/session';

/** FR-2 — join by name. No account, no email, no prompt. */
export function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  return handle(async () => {
    const { token } = await context.params;
    const event = await requireEvent(token);

    if (event.status === 'cancelled') {
      throw conflict('This event was cancelled.', 'event_cancelled');
    }

    await enforce('join', clientIp(request));

    const body = asObject(await readJson(request));
    // Read it loosely and let the shared validator decide: a name of spaces
    // should get "Enter a name so the group knows who you are", not a schema
    // complaint about a missing field.
    const name = validateDisplayName(optionalString(body, 'displayName') ?? '');
    if (!name.ok) throw badRequest(name.error);

    const secret = sessionSecretFrom(request, event.token);
    const existingHash = secret === null ? null : hashSessionSecret(secret);

    // FR-2 — duplicate names are allowed, but the group should be able to tell
    // two Sams apart, so we disambiguate against the names already seated.
    const roster = await listParticipants(event.id);
    const alreadyMine =
      existingHash === null
        ? null
        : await findParticipantBySession(event.id, existingHash);

    let displayName = name.value;
    if (alreadyMine === null) {
      const existingNames = roster.map((p) => p.displayName);
      const resolved = disambiguate([...existingNames, name.value]);
      displayName = resolved[resolved.length - 1] ?? name.value;
    }

    const result = await joinEvent({
      eventId: event.id,
      displayName,
      existingSessionSecretHash: existingHash,
    });

    const native = wantsSecretInBody(request);
    const response = json(
      {
        participant: result.participant,
        rejoined: result.rejoined,
        ...(native && result.session !== null
          ? { sessionSecret: result.session.secret }
          : {}),
      },
      result.rejoined ? 200 : 201,
    );

    if (result.session !== null && !native) {
      const options = cookieOptions();
      setSessionCookie(response, event.token, result.session.secret, {
        secure: options.secure,
        maxAge: options.maxAge,
      });
    }

    return response;
  });
}
