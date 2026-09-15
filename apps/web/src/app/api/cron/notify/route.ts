import { query } from '@/lib/db';
import { unauthorized } from '@/lib/errors';
import { handle, json } from '@/lib/http';
import { notifyEvent } from '@/lib/notify';

interface ActiveEventRow {
  id: string;
  title: string;
  starts_at: Date;
}

/**
 * FR-18 — the notify tick.
 *
 * Runs over active events rather than being triggered by position updates, so
 * "Priya is 5 minutes away" fires when her ETA crosses the line rather than
 * only when her phone happens to report. Scoped to events currently in their
 * check-in window, so a schedule full of next month's dinners costs nothing.
 */
export function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const expected = process.env.CRON_SECRET;
    if (expected === undefined || expected === '') {
      throw unauthorized('Notifications are not configured.', 'not_configured');
    }
    const provided =
      request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    if (!timingSafeEqualString(provided, expected)) {
      throw unauthorized('Bad cron credential.');
    }

    const events = await query<ActiveEventRow>(
      `select id, title, starts_at
         from events
        where status = 'active'
          and starts_at between now() - interval '3 hours'
                            and now() + interval '2 hours'`,
    );

    let planned = 0;
    let sent = 0;
    for (const event of events) {
      // One slow or failing event must not stop the rest of the schedule.
      try {
        const result = await notifyEvent({
          eventId: event.id,
          eventTitle: event.title,
          startsAt: event.starts_at.getTime(),
        });
        planned += result.planned;
        sent += result.sent;
      } catch (error) {
        console.error(`Notify failed for event ${event.id}:`, error);
      }
    }

    return json({ events: events.length, planned, sent });
  });
}

function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
