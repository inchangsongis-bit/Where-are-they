import { sortEntries, type FeedEntry, type FeedKind } from '@wat/core';
import { query, queryOne } from './db';

/**
 * FR-15 — reading and writing the event feed.
 *
 * System events are written by whatever action caused them (an RSVP change, a
 * check-in, an arrival) rather than derived at read time, so the thread is a
 * record of what happened in the order it happened.
 */

interface MessageRow {
  id: string;
  kind: FeedKind;
  participant_id: string | null;
  author_name: string | null;
  body: string | null;
  meta: Record<string, unknown> | null;
  created_at: Date;
}

function toEntry(row: MessageRow): FeedEntry {
  return {
    id: row.id,
    kind: row.kind,
    participantId: row.participant_id,
    authorName: row.author_name,
    body: row.body,
    meta: row.meta,
    createdAt: row.created_at.getTime(),
  };
}

const PAGE_SIZE = 200;

export async function listFeed(
  eventId: string,
  limit = PAGE_SIZE,
): Promise<FeedEntry[]> {
  // Newest first in SQL so a long thread pages from the end, then reversed for
  // reading order.
  const rows = await query<MessageRow>(
    `select id::text as id, kind, participant_id, author_name, body, meta, created_at
       from messages
      where event_id = $1
      order by created_at desc, id desc
      limit $2`,
    [eventId, Math.min(limit, PAGE_SIZE)],
  );
  return sortEntries(rows.map(toEntry));
}

export async function postMessage(args: {
  eventId: string;
  participantId: string;
  authorName: string;
  body: string;
}): Promise<FeedEntry> {
  const row = await queryOne<MessageRow>(
    `insert into messages (event_id, participant_id, author_name, kind, body)
     values ($1, $2, $3, 'text', $4)
     returning id::text as id, kind, participant_id, author_name, body, meta, created_at`,
    [args.eventId, args.participantId, args.authorName, args.body],
  );
  if (row === null) throw new Error('Message insert returned no row');
  return toEntry(row);
}

/** System events: no body, structure in meta, always attributed by name. */
export async function postSystemEvent(args: {
  eventId: string;
  participantId: string;
  authorName: string;
  kind: Exclude<FeedKind, 'text'>;
  meta?: Record<string, unknown>;
}): Promise<void> {
  await query(
    `insert into messages (event_id, participant_id, author_name, kind, meta)
     values ($1, $2, $3, $4, $5)`,
    [
      args.eventId, args.participantId, args.authorName, args.kind,
      args.meta === undefined ? null : JSON.stringify(args.meta),
    ],
  );
}

export async function lastReadAt(participantId: string): Promise<number | null> {
  const row = await queryOne<{ last_read_at: Date }>(
    'select last_read_at from message_reads where participant_id = $1',
    [participantId],
  );
  return row?.last_read_at.getTime() ?? null;
}

export async function markRead(participantId: string): Promise<void> {
  await query(
    `insert into message_reads (participant_id, last_read_at)
     values ($1, now())
     on conflict (participant_id) do update set last_read_at = now()`,
    [participantId],
  );
}
