-- FR-7 — cancelling an event.
--
-- Cancelling is not just a status flag: people may be driving across town with
-- their location being shared. The API stops that (see cancelEvent), and the
-- cancellation itself belongs in the thread like everything else that happened.

alter type message_kind add value if not exists 'cancelled';

-- Who cancelled, and when. Null for the overwhelming majority of events.
alter table events
  add column cancelled_at timestamptz,
  add column cancelled_by uuid references participants (id) on delete set null;
