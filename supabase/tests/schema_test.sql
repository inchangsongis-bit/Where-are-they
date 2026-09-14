-- Schema tests for the Release 1 migration. Run against a scratch database:
--   psql -v ON_ERROR_STOP=1 -f supabase/migrations/0001_release1_schema.sql
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/schema_test.sql
-- Any failure raises, so a clean run means every assertion below held.

\set ON_ERROR_STOP on

create or replace function assert(condition boolean, what text)
returns void language plpgsql as $$
begin
  if condition is not true then
    raise exception 'ASSERTION FAILED: %', what;
  end if;
end;
$$;

-- Asserts that `stmt` is rejected by a constraint.
create or replace function assert_rejects(stmt text, what text)
returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    return;
  end;
  raise exception 'ASSERTION FAILED: expected rejection — %', what;
end;
$$;

-- ------------------------------------------------------------- fixtures ---

insert into events (
  id, token, title, place_name, place_address, place_lat, place_lng,
  starts_at, timezone, location_purge_at, feed_purge_at, expires_at
) values (
  '11111111-1111-1111-1111-111111111111',
  'AAAAAAAAAAAAAAAAAAAAAA',
  'Dinner at Kisa', 'Kisa Izakaya', '118 Bowery', 40.7188, -73.9938,
  now() + interval '1 hour', 'America/New_York',
  now() + interval '6 hours', now() + interval '30 days', now() + interval '7 days'
);

insert into participants (id, event_id, display_name, color, device_token_hash)
values
  ('22222222-2222-2222-2222-222222222222',
   '11111111-1111-1111-1111-111111111111', 'Ana', '#0B6E63', 'hash-ana'),
  ('33333333-3333-3333-3333-333333333333',
   '11111111-1111-1111-1111-111111111111', 'Marco', '#7A5AA8', 'hash-marco');

-- ----------------------------------------------------------- constraints ---

select assert_rejects($$
  insert into events (token, place_name, place_address, place_lat, place_lng,
    starts_at, timezone, location_purge_at, feed_purge_at, expires_at)
  values ('short', 'X', 'Y', 0, 0, now(), 'UTC', now(), now(), now())
$$, 'a token that is not 22 base64url chars');

select assert_rejects($$
  insert into events (token, place_name, place_address, place_lat, place_lng,
    starts_at, timezone, location_purge_at, feed_purge_at, expires_at)
  values ('BBBBBBBBBBBBBBBBBBBBBB', 'X', 'Y', 99, 0, now(), 'UTC', now(), now(), now())
$$, 'a latitude outside -90..90');

select assert_rejects($$
  update participants set status = 'arrived'
  where id = '22222222-2222-2222-2222-222222222222'
$$, 'status=arrived without arrived_at — arrival must be consistent (FR-14)');

select assert_rejects($$
  insert into participants (event_id, display_name, color, device_token_hash)
  values ('11111111-1111-1111-1111-111111111111', 'Ana2', '#000', 'hash-ana')
$$, 'a second participant for the same device in one event');

select assert_rejects($$
  insert into participants (event_id, display_name, color, device_token_hash)
  values ('11111111-1111-1111-1111-111111111111', '', '#000', 'hash-empty')
$$, 'an empty display name');

select assert_rejects($$
  insert into messages (event_id, participant_id, kind, body)
  values ('11111111-1111-1111-1111-111111111111',
          '22222222-2222-2222-2222-222222222222', 'text', '')
$$, 'an empty text message');

select assert_rejects($$
  insert into messages (event_id, participant_id, kind, body)
  values ('11111111-1111-1111-1111-111111111111',
          '22222222-2222-2222-2222-222222222222', 'arrived', 'not allowed')
$$, 'a body on a system event');

-- Arrival with a timestamp is fine.
update participants
   set status = 'arrived', arrived_at = now()
 where id = '22222222-2222-2222-2222-222222222222';
select assert(
  (select count(*) from participants where status = 'arrived') = 1,
  'arrival with a timestamp is accepted');

-- A system event with no author is fine — "Marco arrived" has no speaker.
insert into messages (event_id, participant_id, kind, meta)
values ('11111111-1111-1111-1111-111111111111',
        '33333333-3333-3333-3333-333333333333', 'arrived', '{"at":"7:24"}');

-- Leaving an event must not fail because of the feed. participant_id is
-- ON DELETE SET NULL, so a "joined" row outlives its author with no author.
insert into participants (id, event_id, display_name, color, device_token_hash)
values ('88888888-8888-8888-8888-888888888888',
        '11111111-1111-1111-1111-111111111111', 'Leaver', '#111', 'hash-leaver');
insert into messages (event_id, participant_id, kind)
values ('11111111-1111-1111-1111-111111111111',
        '88888888-8888-8888-8888-888888888888', 'joined');

delete from participants where id = '88888888-8888-8888-8888-888888888888';

select assert(
  (select count(*) from messages
    where kind = 'joined' and participant_id is null) = 1,
  'a departed participant leaves their feed row behind with a null author');

-- ---------------------------------------------------- latest_positions ---

insert into positions (participant_id, lat, lng, accuracy_m, recorded_at) values
  ('33333333-3333-3333-3333-333333333333', 40.70, -73.99, 12, now() - interval '5 min'),
  ('33333333-3333-3333-3333-333333333333', 40.71, -73.99, 10, now() - interval '1 min'),
  ('33333333-3333-3333-3333-333333333333', 40.705, -73.99, 30, now() - interval '3 min');

select assert(
  (select count(*) from latest_positions
    where participant_id = '33333333-3333-3333-3333-333333333333') = 1,
  'latest_positions returns exactly one row per participant');

select assert(
  (select accuracy_m from latest_positions
    where participant_id = '33333333-3333-3333-3333-333333333333') = 10,
  'latest_positions returns the newest fix by recorded_at, not by insert order');

-- ---------------------------------------------------------------- purge ---

-- An event whose location window has passed but which is not itself expired.
insert into events (
  id, token, place_name, place_address, place_lat, place_lng,
  starts_at, timezone, location_purge_at, feed_purge_at, expires_at
) values (
  '44444444-4444-4444-4444-444444444444',
  'CCCCCCCCCCCCCCCCCCCCCC', 'Old Place', '1 Old St', 51.5, -0.1,
  now() - interval '2 days', 'Europe/London',
  now() - interval '1 day', now() + interval '20 days', now() + interval '5 days'
);
insert into participants (id, event_id, display_name, color, device_token_hash)
values ('55555555-5555-5555-5555-555555555555',
        '44444444-4444-4444-4444-444444444444', 'Sam', '#8A6A16', 'hash-sam');
insert into positions (participant_id, lat, lng, accuracy_m, recorded_at)
values ('55555555-5555-5555-5555-555555555555', 51.5, -0.1, 20, now() - interval '2 days');
insert into etas (participant_id, eta_at, distance_m, duration_s, source,
                  computed_from_lat, computed_from_lng)
values ('55555555-5555-5555-5555-555555555555', now() - interval '2 days',
        2400, 600, 'routed', 51.5, -0.1);

-- A fully expired event, to prove the cascade.
insert into events (
  id, token, place_name, place_address, place_lat, place_lng,
  starts_at, timezone, location_purge_at, feed_purge_at, expires_at
) values (
  '66666666-6666-6666-6666-666666666666',
  'DDDDDDDDDDDDDDDDDDDDDD', 'Older Place', '2 Old St', 51.5, -0.1,
  now() - interval '30 days', 'Europe/London',
  now() - interval '29 days', now() - interval '1 day', now() - interval '1 day'
);
insert into participants (id, event_id, display_name, color, device_token_hash)
values ('77777777-7777-7777-7777-777777777777',
        '66666666-6666-6666-6666-666666666666', 'Kim', '#2C7A4C', 'hash-kim');

select * from purge_expired() \gset purge_

select assert(:purge_positions_deleted >= 1,
  'purge deletes positions once the location window closes');
select assert(:purge_etas_deleted >= 1,
  'purge deletes ETAs alongside the positions they came from');
select assert(:purge_events_deleted = 1,
  'purge deletes exactly the one event past its expiry');

select assert(
  (select count(*) from positions
    where participant_id = '55555555-5555-5555-5555-555555555555') = 0,
  'the stale event has no positions left');

select assert(
  (select count(*) from events
    where id = '44444444-4444-4444-4444-444444444444') = 1,
  'purging location data does NOT delete the event itself');

select assert(
  (select count(*) from participants
    where id = '77777777-7777-7777-7777-777777777777') = 0,
  'deleting an expired event cascades to its participants');

select assert(
  (select count(*) from positions
    where participant_id = '33333333-3333-3333-3333-333333333333') = 3,
  'the live event keeps its positions — purge is not indiscriminate');

-- ------------------------------------------------------------------ rls ---

select assert(
  (select count(*) from pg_tables
    where schemaname = 'public' and rowsecurity = false
      and tablename in ('events','participants','positions','etas','messages')) = 0,
  'row level security is enabled on every R1 table');

select assert(
  (select count(*) from pg_policies where schemaname = 'public') = 0,
  'no policies exist, so anon and authenticated are denied by default');

\echo '--- all schema assertions passed ---'
