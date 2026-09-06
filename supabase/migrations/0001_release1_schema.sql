-- Release 1 schema: events, participants, positions, ETAs, feed.
--
-- R1 is guests-only, so there is no accounts or groups table yet — those
-- arrive in R2, and bills in R3 (docs/PLAN.md §14).
--
-- Access model for R1: every read and write goes through a server route
-- handler holding the service-role key, which checks the invite token (and
-- PIN) before touching anything. RLS is therefore enabled with *no* policies,
-- which denies the anon and authenticated roles outright — the API is the
-- only door. R2 replaces this with real per-role policies once accounts exist.

-- ---------------------------------------------------------------- enums ---

create type rsvp_state         as enum ('pending', 'going', 'maybe', 'cant');
create type participant_status as enum ('not_started', 'en_route', 'arrived');
create type travel_mode        as enum ('driving', 'walking', 'transit', 'cycling');
create type tracking_source    as enum ('app_background', 'app_foreground', 'web', 'manual');
create type event_status       as enum ('active', 'cancelled');
create type eta_source         as enum ('routed', 'straight_line');
create type message_kind       as enum ('text', 'joined', 'rsvp', 'checked_in', 'arrived', 'late');

-- --------------------------------------------------------------- events ---

create table events (
  id                uuid primary key default gen_random_uuid(),

  -- PS-4: 128 bits of entropy, base64url, 22 chars. The bearer credential.
  token             text        not null unique,
  check (token ~ '^[A-Za-z0-9_-]{22}$'),

  -- PS-5: optional 4-digit PIN, hashed. Never stored in the clear.
  pin_hash          text,

  title             text        not null default 'Dinner',
  check (char_length(title) between 1 and 80),

  -- FR-7: an event without coordinates cannot produce an ETA, so it is
  -- rejected at creation rather than degrading silently later.
  place_name        text        not null,
  place_address     text        not null,
  place_lat         double precision not null check (place_lat between -90 and 90),
  place_lng         double precision not null check (place_lng between -180 and 180),

  starts_at         timestamptz not null,
  timezone          text        not null,
  status            event_status not null default 'active',

  -- FR-19: three clocks, because location, feed and event records do not
  -- deserve the same lifetime.
  location_purge_at timestamptz not null,
  feed_purge_at     timestamptz not null,
  expires_at        timestamptz not null,

  created_at        timestamptz not null default now()
);

create index events_expiry_idx on events (expires_at);
create index events_location_purge_idx on events (location_purge_at);

-- --------------------------------------------------------- participants ---

create table participants (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid        not null references events (id) on delete cascade,

  display_name      text        not null,
  check (char_length(display_name) between 1 and 24),

  color             text        not null,
  is_organizer      boolean     not null default false,

  rsvp              rsvp_state          not null default 'pending',
  status            participant_status  not null default 'not_started',
  travel_mode       travel_mode         not null default 'driving',
  tracking_source   tracking_source     not null default 'web',
  sharing           boolean     not null default false,

  -- FR-9: the manual fallback when location is denied or unavailable.
  self_reported_eta timestamptz,
  arrived_at        timestamptz,

  -- PS-6: identity is a hash of a server-issued token, never a client value.
  device_token_hash text        not null,

  created_at        timestamptz not null default now(),

  -- One device is one participant in a given event.
  unique (event_id, device_token_hash)
);

create index participants_event_idx on participants (event_id);

-- FR-14: arrival is sticky, so arrived_at must be set exactly when status is.
alter table participants add constraint participants_arrival_consistent
  check ((status = 'arrived') = (arrived_at is not null));

-- ------------------------------------------------------------ positions ---

-- PS-3: latest position plus a short trail only. The purge job (FR-19) is
-- what keeps this from becoming a location history.
create table positions (
  id             bigserial primary key,
  participant_id uuid   not null references participants (id) on delete cascade,

  lat            double precision not null check (lat between -90 and 90),
  lng            double precision not null check (lng between -180 and 180),
  accuracy_m     real   not null check (accuracy_m >= 0),

  -- Client clock: an offline queue flushes late, and the age of the fix is
  -- what the staleness rules (FR-11) depend on — not when we received it.
  recorded_at    timestamptz not null,
  received_at    timestamptz not null default now()
);

create index positions_participant_recorded_idx
  on positions (participant_id, recorded_at desc);

-- ----------------------------------------------------------------- etas ---

create table etas (
  participant_id uuid primary key references participants (id) on delete cascade,
  eta_at         timestamptz not null,
  distance_m     integer     not null check (distance_m >= 0),
  duration_s     integer     not null check (duration_s >= 0),
  source         eta_source  not null,

  -- The position this was computed from, so FR-11 can decide whether to spend
  -- another routing call.
  computed_from_lat double precision not null,
  computed_from_lng double precision not null,
  computed_at    timestamptz not null default now()
);

-- ------------------------------------------------------------- messages ---

create table messages (
  id             bigserial primary key,
  event_id       uuid        not null references events (id) on delete cascade,

  -- Null for system events: "Marco arrived 7:24" has no author.
  participant_id uuid        references participants (id) on delete set null,

  kind           message_kind not null,
  body           text,
  meta           jsonb,
  created_at     timestamptz not null default now(),

  -- FR-15: text messages carry a body; system events carry structure instead.
  check (
    (kind = 'text' and body is not null and char_length(body) between 1 and 500)
    or (kind <> 'text' and body is null)
  ),
  check (kind = 'text' or participant_id is not null or meta is not null)
);

create index messages_event_created_idx on messages (event_id, created_at desc);

-- ---------------------------------------------------------------- views ---

-- The single most-read query in the product: each participant's newest fix.
create view latest_positions as
select distinct on (participant_id)
  participant_id, lat, lng, accuracy_m, recorded_at, received_at
from positions
order by participant_id, recorded_at desc;

-- ---------------------------------------------------------------- purge ---

-- FR-19: enforced by a scheduled job, not by filtering at read time. Data
-- that is merely hidden has not been deleted.
create or replace function purge_expired() returns table (
  positions_deleted bigint,
  etas_deleted      bigint,
  messages_deleted  bigint,
  events_deleted    bigint
) language plpgsql security definer as $$
declare
  n_positions bigint;
  n_etas      bigint;
  n_messages  bigint;
  n_events    bigint;
begin
  with gone as (
    delete from positions p
    using participants pt, events ev
    where p.participant_id = pt.id
      and pt.event_id = ev.id
      and ev.location_purge_at <= now()
    returning 1
  ) select count(*) into n_positions from gone;

  with gone as (
    delete from etas et
    using participants pt, events ev
    where et.participant_id = pt.id
      and pt.event_id = ev.id
      and ev.location_purge_at <= now()
    returning 1
  ) select count(*) into n_etas from gone;

  with gone as (
    delete from messages ms
    using events ev
    where ms.event_id = ev.id and ev.feed_purge_at <= now()
    returning 1
  ) select count(*) into n_messages from gone;

  -- Cascades take participants, positions, etas and messages with it.
  with gone as (
    delete from events where expires_at <= now() returning 1
  ) select count(*) into n_events from gone;

  return query select n_positions, n_etas, n_messages, n_events;
end;
$$;

-- ------------------------------------------------------------------ rls ---

alter table events       enable row level security;
alter table participants enable row level security;
alter table positions    enable row level security;
alter table etas         enable row level security;
alter table messages     enable row level security;

-- No policies on purpose: anon and authenticated are denied everything, and
-- only the service role (used by our route handlers, never the browser) gets
-- through. R2 adds real policies alongside accounts and roles.
