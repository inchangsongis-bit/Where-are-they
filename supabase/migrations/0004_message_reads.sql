-- FR-15 — unread counts for the feed tab.
--
-- Deliberately per-participant "last read at", not per-message read receipts.
-- Receipts change how people behave in a thread — they make not replying
-- visible — and this is a feed for coordinating a dinner, not a messenger.

create table message_reads (
  participant_id uuid primary key references participants (id) on delete cascade,
  last_read_at   timestamptz not null default now()
);

-- FR-15 — the author's name is denormalised onto the entry.
--
-- messages.participant_id is ON DELETE SET NULL, so when someone leaves the
-- event their "Marco arrived" line would otherwise become "Someone arrived".
-- The feed is a record of what happened; it should keep reading correctly
-- after the cast changes.
alter table messages add column author_name text;

alter table message_reads enable row level security;
-- No policies: service role only, like every other R1 table.
