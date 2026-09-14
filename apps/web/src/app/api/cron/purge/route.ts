import { queryOne } from '@/lib/db';
import { unauthorized } from '@/lib/errors';
import { handle, json } from '@/lib/http';

interface PurgeRow {
  positions_deleted: string;
  etas_deleted: string;
  messages_deleted: string;
  events_deleted: string;
}

/**
 * FR-19 — scheduled retention. Deletes, rather than filtering at read time:
 * data that is merely hidden has not been deleted.
 *
 * Guarded by a shared secret compared in constant time. Without CRON_SECRET set
 * the route refuses outright rather than running unauthenticated.
 */
export function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const expected = process.env.CRON_SECRET;
    if (expected === undefined || expected === '') {
      throw unauthorized('Purge is not configured.', 'not_configured');
    }

    const provided =
      request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    if (!timingSafeEqualString(provided, expected)) {
      throw unauthorized('Bad purge credential.');
    }

    const purged = await queryOne<PurgeRow>('select * from purge_expired()');
    const rateLimits = await queryOne<{ purge_rate_limits: string }>(
      'select purge_rate_limits()',
    );

    return json({
      positionsDeleted: Number(purged?.positions_deleted ?? 0),
      etasDeleted: Number(purged?.etas_deleted ?? 0),
      messagesDeleted: Number(purged?.messages_deleted ?? 0),
      eventsDeleted: Number(purged?.events_deleted ?? 0),
      rateLimitsDeleted: Number(rateLimits?.purge_rate_limits ?? 0),
    });
  });
}

function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
