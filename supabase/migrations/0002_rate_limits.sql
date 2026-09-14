-- PS-7 — rate limits that survive a cold start.
--
-- The obvious implementation is an in-memory counter, which is worthless here:
-- the web app runs as serverless functions, so each invocation may start with
-- an empty map. A four-digit PIN behind a counter that resets on demand is not
-- protected at all. So the counter lives in Postgres and the increment is one
-- atomic statement.
--
-- Fixed window rather than sliding: simpler, one row per key, and the failure
-- mode (a caller getting up to 2x the limit across a window boundary) is
-- irrelevant at these limits.

create table rate_limits (
  key          text        primary key,
  window_start timestamptz not null,
  count        integer     not null check (count >= 0)
);

-- Old rows are garbage after their window closes; the purge job sweeps them.
create index rate_limits_window_idx on rate_limits (window_start);

create or replace function consume_rate_limit(
  p_key    text,
  p_limit  integer,
  p_window interval
) returns table (
  allowed       boolean,
  used          integer,
  retry_after_s integer
) language plpgsql as $$
declare
  v_count        integer;
  v_window_start timestamptz;
begin
  -- One statement, so concurrent callers cannot both read "9 of 10".
  insert into rate_limits as rl (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update
    set window_start = case
          when rl.window_start + p_window <= now() then now()
          else rl.window_start
        end,
        count = case
          when rl.window_start + p_window <= now() then 1
          else rl.count + 1
        end
  returning rl.count, rl.window_start into v_count, v_window_start;

  return query select
    v_count <= p_limit,
    v_count,
    greatest(0, ceil(extract(epoch from (v_window_start + p_window - now()))))::integer;
end;
$$;

-- Fold rate-limit cleanup into the existing purge so there is one scheduled job.
create or replace function purge_rate_limits(p_older_than interval default interval '1 day')
returns bigint language plpgsql as $$
declare n bigint;
begin
  with gone as (
    delete from rate_limits where window_start < now() - p_older_than returning 1
  ) select count(*) into n from gone;
  return n;
end;
$$;

alter table rate_limits enable row level security;
-- No policies: service role only, like every other R1 table.
