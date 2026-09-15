import { markRead } from '@/lib/feed';
import { handle, json, requireEvent, requireParticipant } from '@/lib/http';

/** FR-15 — unread counts only. No read receipts, deliberately. */
export function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  return handle(async () => {
    const { token } = await context.params;
    const event = await requireEvent(token);
    const me = await requireParticipant(request, event);
    await markRead(me.id);
    return json({ ok: true });
  });
}
