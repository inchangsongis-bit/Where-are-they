import type { Position, TrackingSource } from '@wat/core';
import { badRequest } from '@/lib/errors';
import { handle, json, readJson, requireEvent, requireParticipant } from '@/lib/http';
import { asObject, requireLatLng, requireNumber, requireTimestamp } from '@/lib/parse';
import { enforce } from '@/lib/ratelimit';
import { recordPositions } from '@/lib/tracking';

const MAX_BATCH = 120; // ~30 minutes of queued fixes, per the offline NFR

const SOURCES: readonly TrackingSource[] = [
  'app_background', 'app_foreground', 'web', 'manual',
];

function parsePosition(raw: unknown): Position {
  const body = asObject(raw);
  const { lat, lng } = requireLatLng(body);
  const accuracyM = body['accuracyM'] === undefined ? 0 : requireNumber(body, 'accuracyM');
  if (accuracyM < 0) throw badRequest('"accuracyM" cannot be negative.');
  return {
    lat,
    lng,
    accuracyM,
    // Client clock, deliberately: the age of the fix is what the staleness
    // rules depend on, not when it happened to reach us (FR-11).
    recordedAt: requireTimestamp(body, 'recordedAt'),
  };
}

/** FR-9 — accepts one fix, or a batch when an offline queue flushes. */
export function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  return handle(async () => {
    const { token } = await context.params;
    const event = await requireEvent(token);
    const me = await requireParticipant(request, event);

    await enforce('position', me.id);

    const body = asObject(await readJson(request));
    const rawPositions = body['positions'];

    let positions: Position[];
    if (Array.isArray(rawPositions)) {
      if (rawPositions.length === 0) throw badRequest('No positions to record.');
      if (rawPositions.length > MAX_BATCH) {
        throw badRequest(`Send at most ${MAX_BATCH} positions at a time.`);
      }
      positions = rawPositions.map(parsePosition);
    } else {
      positions = [parsePosition(body)];
    }

    const rawSource = body['source'];
    const source: TrackingSource =
      typeof rawSource === 'string' && (SOURCES as readonly string[]).includes(rawSource)
        ? (rawSource as TrackingSource)
        : 'web';

    const result = await recordPositions({
      participantId: me.id, event, positions, source,
    });

    return json(result);
  });
}
