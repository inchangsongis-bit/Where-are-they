import { query } from '@/lib/db';
import { badRequest } from '@/lib/errors';
import { handle, json, readJson, requireEvent, requireParticipant } from '@/lib/http';
import { asObject, optionalString } from '@/lib/parse';

/** PS-12 — register or revoke this device's push token. */
export function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  return handle(async () => {
    const { token } = await context.params;
    const event = await requireEvent(token);
    const me = await requireParticipant(request, event);

    const body = asObject(await readJson(request));
    const pushToken = optionalString(body, 'pushToken');

    if (pushToken !== undefined && pushToken.length > 512) {
      throw badRequest('That does not look like a push token.');
    }

    await query('update participants set push_token = $2 where id = $1', [
      me.id,
      pushToken === undefined || pushToken === '' ? null : pushToken,
    ]);

    return json({ ok: true, registered: pushToken !== undefined && pushToken !== '' });
  });
}
