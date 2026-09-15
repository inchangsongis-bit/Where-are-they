-- FR-18 — push notifications.

create type notification_kind as enum ('proximity', 'all_here', 'nudge', 'late', 'message');

alter table participants
  -- PS-12: per device, revoked on leave, deleted with the event.
  add column push_token text,
  -- FR-18: per-event mute. Off by default; nobody opts into a dinner app.
  add column muted boolean not null default false;

-- FR-18 — the dedupe ledger.
--
-- "Priya is 5 minutes away" is interesting exactly once. Without a record of
-- what has already gone out, every tick of the notify job would send it again,
-- which is the fastest way to get an app muted for good.
--
-- participant_id is the *subject* of the notification, not the recipient: one
-- proximity alert per person per event, however many people receive it.
create table notifications_sent (
  participant_id uuid              not null references participants (id) on delete cascade,
  kind           notification_kind not null,
  sent_at        timestamptz       not null default now(),
  primary key (participant_id, kind)
);

-- FR-18 — message collapsing is a window, not a once-ever fact, so it lives on
-- the event rather than in the ledger above: a burst of messages inside a
-- minute is one notification, and the next burst is another.
alter table events add column message_notified_at timestamptz;

alter table notifications_sent enable row level security;
-- No policies: service role only, like every other R1 table.
