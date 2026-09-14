import { findEventPinHash } from '@/lib/events';
import { forbidden } from '@/lib/errors';
import { clientIp, handle, json, readJson, requireEvent } from '@/lib/http';
import { asObject, requireString } from '@/lib/parse';
import { verifyPin } from '@/lib/pin';
import { enforce } from '@/lib/ratelimit';

/**
 * PS-5 — verify the optional event PIN.
 *
 * Rate limited per IP and per event before the hash is even loaded, because
 * four digits is 10,000 guesses and the limit is the only thing that makes it
 * meaningful. A wrong PIN and an event with no PIN give the same answer shape,
 * so this cannot be used to discover whether an event is protected.
 */
export function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  return handle(async () => {
    const { token } = await context.params;
    const event = await requireEvent(token);

    await enforce('pin', `${event.id}:${clientIp(request)}`);

    const body = asObject(await readJson(request));
    const pin = requireString(body, 'pin');

    const hash = await findEventPinHash(event.token);
    if (hash === null) return json({ ok: true, pinRequired: false });

    if (!(await verifyPin(pin, hash))) {
      throw forbidden('That PIN is not right.', 'bad_pin');
    }

    return json({ ok: true, pinRequired: true });
  });
}
